import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

type Ctx = { dbOrganizationId:(req:any)=>string|null };

export function registerWorkstream4JourneyRoutes(app:FastifyInstance,pool:Pool|null,ctx:Ctx){
  const requireDb=(reply:any)=>{if(!pool){reply.code(501).send({error:'PostgreSQL required'});return false;}return true;};
  const oid=(req:any)=>ctx.dbOrganizationId(req);

  app.get('/api/journeys/synthetic',async(req:any,reply:any)=>{
    if(!requireDb(reply))return;
    const organizationId=oid(req);
    if(!organizationId)return reply.code(400).send({error:'Organization context is required'});
    const query=z.object({patientNumber:z.string().regex(/^TEST-\d{3}$/).optional(),journeyKey:z.string().min(1).max(120).optional(),status:z.enum(['completed','active','needs-follow-up','referred']).optional(),limit:z.coerce.number().int().min(1).max(200).default(100)}).parse(req.query||{});
    const params:any[]=[organizationId];
    const where=['j.organization_id=$1'];
    if(query.patientNumber){params.push(query.patientNumber);where.push(`p.patient_number=$${params.length}`);}
    if(query.journeyKey){params.push(query.journeyKey);where.push(`j.journey_key=$${params.length}`);}
    if(query.status){params.push(query.status);where.push(`j.status=$${params.length}`);}
    params.push(query.limit);
    const r=await pool!.query(`SELECT j.id,j.patient_id AS "patientId",p.patient_number AS "patientNumber",j.journey_key AS "journeyKey",j.title,j.status,j.scenario,j.source,j.started_at AS "startedAt",j.completed_at AS "completedAt",count(s.id)::int AS "stepCount",count(s.authoritative_id)::int AS "linkedAuthoritativeSteps",count(cw.id)::int AS "workflowEvents"
      FROM synthetic_journeys j JOIN patients p ON p.id=j.patient_id LEFT JOIN synthetic_journey_steps s ON s.journey_id=j.id LEFT JOIN clinical_workflow_events cw ON cw.source_event_id=s.outbox_event_id
      WHERE ${where.join(' AND ')} GROUP BY j.id,p.patient_number ORDER BY j.started_at DESC LIMIT $${params.length}`,[...params]);
    return {data:r.rows,count:r.rowCount};
  });

  app.get('/api/journeys/synthetic/:patientId',async(req:any,reply:any)=>{
    if(!requireDb(reply))return;
    const organizationId=oid(req);
    if(!organizationId)return reply.code(400).send({error:'Organization context is required'});
    const patientId=z.string().uuid().parse(req.params.patientId);
    const journeys=await pool!.query(`SELECT j.id,j.patient_id AS "patientId",p.patient_number AS "patientNumber",j.journey_key AS "journeyKey",j.title,j.status,j.scenario,j.source,j.started_at AS "startedAt",j.completed_at AS "completedAt" FROM synthetic_journeys j JOIN patients p ON p.id=j.patient_id WHERE j.organization_id=$1 AND j.patient_id=$2 ORDER BY j.started_at DESC`,[organizationId,patientId]);
    if(!journeys.rowCount)return reply.code(404).send({error:'Synthetic journey not found'});
    const steps=await pool!.query(`SELECT s.id,s.journey_id AS "journeyId",s.sequence_no AS "sequence",s.step_key AS "stepKey",s.title,s.event_type AS "eventType",s.authoritative_table AS "authoritativeTable",s.authoritative_id AS "authoritativeId",s.authoritative_scope AS "authoritativeScope",s.consequence,s.status,s.occurred_at AS "occurredAt",s.metadata FROM synthetic_journey_steps s JOIN synthetic_journeys j ON j.id=s.journey_id WHERE j.organization_id=$1 AND j.patient_id=$2 ORDER BY s.journey_id,s.sequence_no`,[organizationId,patientId]);
    return {journeys:journeys.rows,steps:steps.rows};
  });

  app.get('/api/journeys/synthetic/by-number/:patientNumber',async(req:any,reply:any)=>{
    if(!requireDb(reply))return;
    const organizationId=oid(req);
    if(!organizationId)return reply.code(400).send({error:'Organization context is required'});
    const patientNumber=z.string().regex(/^TEST-\d{3}$/).parse(req.params.patientNumber);
    const patient=await pool!.query(`SELECT id FROM patients WHERE organization_id=$1 AND patient_number=$2 AND is_test_data=true`,[organizationId,patientNumber]);
    if(!patient.rowCount)return reply.code(404).send({error:'Synthetic test patient not found'});
    const patientId=patient.rows[0].id;
    const journeys=await pool!.query(`SELECT j.id,journey_key AS "journeyKey",title,status,scenario,source,started_at AS "startedAt",completed_at AS "completedAt" FROM synthetic_journeys j WHERE j.organization_id=$1 AND j.patient_id=$2 ORDER BY j.started_at DESC`,[organizationId,patientId]);
    const steps=await pool!.query(`SELECT s.journey_id AS "journeyId",s.sequence_no AS "sequence",s.step_key AS "stepKey",s.title,s.event_type AS "eventType",s.authoritative_table AS "authoritativeTable",s.authoritative_scope AS "authoritativeScope",s.consequence,s.status,s.occurred_at AS "occurredAt" FROM synthetic_journey_steps s WHERE s.organization_id=$1 AND s.patient_id=$2 ORDER BY s.journey_id,s.sequence_no`,[organizationId,patientId]);
    return {patientNumber,journeys:journeys.rows,steps:steps.rows};
  });

  app.get('/api/public/test-patients/:patientNumber/journeys',async(req:any,reply:any)=>{
    if(!requireDb(reply))return;
    const patientNumber=z.string().regex(/^TEST-\d{3}$/).parse(req.params.patientNumber);
    const r=await pool!.query(`SELECT p.patient_number AS "patientNumber",j.journey_key AS "journeyKey",j.title,j.status,j.scenario,j.started_at AS "startedAt",j.completed_at AS "completedAt",
      COALESCE(jsonb_agg(jsonb_build_object('sequence',s.sequence_no,'stepKey',s.step_key,'title',s.title,'eventType',s.event_type,'consequence',s.consequence,'status',s.status,'occurredAt',s.occurred_at) ORDER BY s.sequence_no) FILTER (WHERE s.id IS NOT NULL),'[]'::jsonb) AS steps
      FROM patients p JOIN synthetic_journeys j ON j.patient_id=p.id LEFT JOIN synthetic_journey_steps s ON s.journey_id=j.id
      WHERE p.patient_number=$1 AND p.is_test_data=true AND j.source='workstream4-synthetic'
      GROUP BY p.patient_number,j.id ORDER BY j.started_at DESC`,[patientNumber]);
    if(!r.rowCount)return reply.code(404).send({error:'Synthetic patient journey not found'});
    return {synthetic:true,patientNumber,journeys:r.rows};
  });
}
