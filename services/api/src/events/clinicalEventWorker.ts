import type { Pool } from 'pg';
import { evaluateClinicalEvent } from './cdssEvaluator.js';

let timer: NodeJS.Timeout | undefined;
let running = false;

export function startClinicalEventWorker(pool: Pool | null) {
  if (!pool || timer) return;
  const poll = async () => {
    if (running) return;
    running = true;
    try {
      for (let i = 0; i < 10; i += 1) {
        const client = await pool.connect();
        let event: any = null;
        try {
          await client.query('BEGIN');
          const claimed = await client.query(`
            SELECT id,organization_id,event_type,aggregate_type,aggregate_id,payload
            FROM outbox_events
            WHERE status='pending' AND available_at <= now()
            ORDER BY created_at
            FOR UPDATE SKIP LOCKED LIMIT 1
          `);
          if (!claimed.rowCount) { await client.query('ROLLBACK'); break; }
          event = claimed.rows[0];
          await client.query(`UPDATE outbox_events SET status='processing',attempts=attempts+1,locked_at=now(),worker_id=$2 WHERE id=$1`, [event.id, 'clinai-cdss-worker']);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally { client.release(); }

        try {
          await evaluateClinicalEvent(pool, event);
          await pool.query(`UPDATE outbox_events SET status='processed',processed_at=now(),locked_at=NULL,worker_id=NULL,last_error=NULL WHERE id=$1`, [event.id]);
        } catch (error: any) {
          const message = String(error?.message || 'CDSS event processing failed').slice(0, 1000);
          await pool.query(`UPDATE outbox_events SET status='pending',available_at=now()+interval '30 seconds',locked_at=NULL,worker_id=NULL,last_error=$2 WHERE id=$1`, [event.id, message]);
        }
      }
    } catch {
      // Keep the worker alive. Individual event failures are recorded on the outbox row.
    } finally { running = false; }
  };
  timer = setInterval(() => { void poll(); }, 2000);
  void poll();
}
