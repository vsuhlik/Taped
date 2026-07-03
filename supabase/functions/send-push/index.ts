import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import webpush from 'npm:web-push'
import { createClient } from 'npm:@supabase/supabase-js'

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT')! 

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

serve(async (req) => {
  try {
    const payload = await req.json()

    // We only care about updates to the shared_status table
    if (payload.type !== 'UPDATE') {
      return new Response('Not an update', { status: 200 })
    }

    const oldRecord = payload.old_record
    const newRecord = payload.record

    // Determine what changed to build a helpful push message
    let title = 'Taped Status Updated'
    let body = 'Check the app for the latest status.'

    if (oldRecord.husband_is_taped !== newRecord.husband_is_taped) {
      title = 'Husband Tape Status'
      body = newRecord.husband_is_taped ? 'Now Taped' : 'Tape Off'
    } else if (oldRecord.wife_status !== newRecord.wife_status) {
      title = 'Wife Availability'
      body = newRecord.wife_status.replace('_', ' ').toUpperCase()
    }

    // Initialize Supabase admin client to fetch user subscriptions
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey)

    // Fetch all push subscriptions from the database
    const { data: subscriptions, error } = await supabaseAdmin
      .from('push_subscriptions')
      .select('*')

    if (error) throw error

    // Fire off the push notifications
    const pushPromises = subscriptions.map((sub) => {
      return webpush.sendNotification(
        sub.subscription,
        JSON.stringify({ title, body })
      ).catch((err) => {
        console.error('Error sending push to endpoint:', sub.endpoint, err)
        // Note: In a production app, you would delete expired subscriptions from the DB here
      })
    })

    await Promise.all(pushPromises)

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})