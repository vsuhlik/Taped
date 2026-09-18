import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import webpush from 'npm:web-push'
import { createClient } from 'npm:@supabase/supabase-js'

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Role = 'husband' | 'wife'

serve(async (req) => {
  // CORS preflight — the browser's "can I talk to you?" check
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: userData, error: userError } = await userClient.auth.getUser()
    if (userError || !userData.user) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    }

    const userId = userData.user.id
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    const { data: senderProfile, error: senderError } = await admin
      .from('profiles')
      .select('role, display_name')
      .eq('id', userId)
      .single()

    if (senderError || !senderProfile) {
      return new Response('Profile not found', { status: 404, headers: corsHeaders })
    }

    const senderRole = senderProfile.role as Role
    const senderName = senderProfile.display_name as string
    const recipientRole: Role = senderRole === 'husband' ? 'wife' : 'husband'

    const { data: recipientProfile } = await admin
      .from('profiles')
      .select('id')
      .eq('role', recipientRole)
      .single()

    if (!recipientProfile) {
      return new Response(JSON.stringify({ success: true, sent: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, subscription')
      .eq('user_id', recipientProfile.id)

    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const expiredIds: string[] = []

    await Promise.all(
      subs.map((sub) =>
        webpush
          .sendNotification(sub.subscription as any, JSON.stringify({
            title: senderName,
            body: '❤️',
            url: '/',
          }))
          .catch((err) => {
            const status = (err as { statusCode?: number })?.statusCode
            if (status === 404 || status === 410) {
              expiredIds.push(sub.id)
            } else {
              console.error('Push failed', sub.endpoint, err)
            }
          })
      )
    )

    if (expiredIds.length > 0) {
      await admin.from('push_subscriptions').delete().in('id', expiredIds)
    }

    return new Response(
      JSON.stringify({ success: true, sent: subs.length, cleaned: expiredIds.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error(err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})