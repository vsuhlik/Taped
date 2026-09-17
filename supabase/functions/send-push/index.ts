import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import webpush from 'npm:web-push'
import { createClient } from 'npm:@supabase/supabase-js'

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT')!
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET')!

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

type Role = 'husband' | 'wife'

type PushSubRow = {
  id: string
  user_id: string
  endpoint: string
  subscription: unknown
}

serve(async (req) => {
  try {
    // Reject anything that does not include our shared secret header
    const incomingSecret = req.headers.get('x-webhook-secret')
    if (!WEBHOOK_SECRET || incomingSecret !== WEBHOOK_SECRET) {
      return new Response('Unauthorized', { status: 401 })
    }

    const payload = await req.json()

    if (payload.type !== 'UPDATE' || payload.table !== 'shared_status') {
      return new Response('Not a shared_status update', { status: 200 })
    }

    const oldRecord = payload.old_record
    const newRecord = payload.record

    // Decide what changed and who should hear about it
    let notifyRole: Role
    let title: string
    let body: string

    if (oldRecord.husband_is_taped !== newRecord.husband_is_taped) {
      notifyRole = 'wife'
      title = 'Husband Tape Status'
      body = newRecord.husband_is_taped ? 'Now Taped' : 'Tape Off'
    } else if (oldRecord.tape_estimated_off !== newRecord.tape_estimated_off) {
      notifyRole = 'wife'
      title = 'Tape Off-Time Updated'
      body = newRecord.tape_estimated_off
        ? `Scheduled off: ${new Date(newRecord.tape_estimated_off).toLocaleString('en-US', {
            weekday: 'short',
            hour: 'numeric',
            minute: '2-digit',
          })}`
        : 'Off-time cleared'
    } else if (oldRecord.wife_status !== newRecord.wife_status) {
      notifyRole = 'husband'
      title = 'Wife Availability'
      body = String(newRecord.wife_status).replace('_', ' ').toUpperCase()
    } else {
      // Only last_updated changed, or nothing relevant — skip silently
      return new Response(JSON.stringify({ success: true, skipped: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Admin client (service role, bypasses RLS) so we can read all profiles
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey)

    // Fetch subscriptions + profiles, then join in memory
    const [{ data: subs, error: subsError }, { data: profiles, error: profilesError }] =
      await Promise.all([
        supabaseAdmin.from('push_subscriptions').select('id, user_id, endpoint, subscription'),
        supabaseAdmin.from('profiles').select('id, role'),
      ])

    if (subsError) throw subsError
    if (profilesError) throw profilesError

    const roleByUserId = new Map<string, Role>(
      (profiles ?? []).map((p) => [p.id as string, p.role as Role])
    )

    const targets = ((subs ?? []) as PushSubRow[]).filter(
      (sub) => roleByUserId.get(sub.user_id) === notifyRole
    )

    // Send, and collect expired subscriptions for cleanup
    const expiredIds: string[] = []

    await Promise.all(
      targets.map((sub) =>
        webpush
          .sendNotification(sub.subscription as any, JSON.stringify({ title, body }))
          .catch((err) => {
            const status = (err as { statusCode?: number })?.statusCode
            if (status === 404 || status === 410) {
              expiredIds.push(sub.id)
            } else {
              console.error('Push failed for endpoint', sub.endpoint, err)
            }
          })
      )
    )

    if (expiredIds.length > 0) {
      await supabaseAdmin.from('push_subscriptions').delete().in('id', expiredIds)
    }

    return new Response(
      JSON.stringify({ success: true, sent: targets.length, cleaned: expiredIds.length }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error(err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})