declare module 'fastify' { const Fastify: any; export default Fastify; export type FastifyInstance = any; }
declare module '@fastify/cors' { const cors: any; export default cors; }
declare module '@fastify/jwt' { const jwt: any; export default jwt; }
declare module 'zod' { const z:any; export { z }; }
declare module 'pg' { export class Pool { constructor(...args:any[]); query:any; connect:any; end:any; } export type PoolClient = any; }
declare module 'node:crypto' { export const randomUUID:any; export const createHash:any; }
declare module 'crypto' { export const randomUUID:any; export const createHash:any; }
declare module 'node:fs/promises' { export const readFile:any; export const writeFile:any; export const mkdir:any; }
declare module 'node:path' { export const dirname:any; }
declare namespace NodeJS { type Timeout = number; }
declare const process:any;
declare const Buffer:any;
