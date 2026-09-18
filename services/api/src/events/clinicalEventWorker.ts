import type { Pool } from 'pg';
import { evaluateClinicalContext } from '../intelligence/cdssGateway.js';
import { processClinicalEvent, scanUnfinishedJourneys } from './clinicalJourneyEngine.js';

let timer: NodeJS.Timeout | undefined;
let running = false;
const WORKER_ID = `clinai-event-worker-${process.pid}`;
const MAX_BATCH = 10;
const STALE_AFTER_MINUTES = 10;

export function startClinicalEventWorker(pool: Pool | null) {
  if (!pool || timer) return;
  const poll = async () => {
    if (running) return;
    running = true;
    try {
      // Recover events abandoned by a crashed worker. Only stale processing rows are touched.
      await pool.query(`
        UPDATE outbox_events
        SET status='pending', available_at=now(), locked_at=NULL, worker_id=NULL,
            last_error=COALESCE(last_error,'Recovered stale event claim')
        WHERE status='processing' AND locked_at < now() - ($1::text || ' minutes')::interval
          AND attempts < max_attempts`, [STALE_AFTER_MINUTES]);

      for (let i = 0; i < MAX_BATCH; i += 1) {
        const client = await pool.connect();
        let event: any = null;
        try {
          await client.query('BEGIN');
          const claimed = await client.query(`
            SELECT id,organization_id,event_type,aggregate_type,aggregate_id,payload,
                   correlation_id,causation_id,schema_version,attempts,max_attempts
            FROM outbox_events
            WHERE status='pending' AND available_at <= now() AND attempts < max_attempts
            ORDER BY created_at
            FOR UPDATE SKIP LOCKED LIMIT 1
          `);
          if (!claimed.rowCount) { await client.query('ROLLBACK'); break; }
          event = claimed.rows[0];
          await client.query(`
            UPDATE outbox_events
            SET status='processing', attempts=attempts+1, locked_at=now(), worker_id=$2
            WHERE id=$1`, [event.id, WORKER_ID]);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally { client.release(); }

        try {
          await processClinicalEvent(pool, event);
          if (event.payload?.patientId) {
            await scanUnfinishedJourneys(pool, event.organization_id, String(event.payload.patientId));
          }
          await evaluateClinicalContext(pool, {
            mode: 'async',
            trigger: {
              eventId: event.id,
              eventType: event.event_type,
              organizationId: event.organization_id,
              aggregateType: event.aggregate_type,
              aggregateId: event.aggregate_id,
              patientId: event.payload?.patientId ?? null,
              encounterId: event.payload?.encounterId ?? null,
              payload: event.payload || {},
            },
          });
          await pool.query(`
            UPDATE outbox_events
            SET status='processed', processed_at=now(), locked_at=NULL,
                worker_id=NULL, last_error=NULL
            WHERE id=$1`, [event.id]);
        } catch (error: any) {
          const message = String(error?.message || 'Clinical event processing failed').slice(0, 1000);
          await pool.query(`
            UPDATE outbox_events
            SET status=CASE WHEN attempts >= max_attempts THEN 'dead_lettered' ELSE 'pending' END,
                available_at=CASE WHEN attempts >= max_attempts THEN available_at ELSE now()+interval '30 seconds' END,
                locked_at=NULL, worker_id=NULL, last_error=$2,
                dead_lettered_at=CASE WHEN attempts >= max_attempts THEN now() ELSE dead_lettered_at END
            WHERE id=$1`, [event.id, message]);
        }
      }
    } catch {
      // Keep the worker alive. Individual event failures are recorded on the outbox row.
    } finally { running = false; }
  };
  timer = setInterval(() => { void poll(); }, 2000);
  void poll();
}
