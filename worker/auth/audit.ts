import { sha256 } from './crypto'
import { requestIp } from '../http'

/** Records an administrator action. Only a hash of the caller's IP is kept. */
export async function auditAdminEvent(
  request: Request,
  env: Env,
  action: string,
  targetAccountId: string | null,
  metadata: Record<string, unknown> = {},
) {
  const ipHash = await sha256(requestIp(request))
  await env.DB
    .prepare(
      `INSERT INTO admin_audit_log (action, target_account_id, metadata, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(action, targetAccountId, JSON.stringify(metadata), ipHash, Date.now())
    .run()
}
