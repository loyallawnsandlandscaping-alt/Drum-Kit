// src/lib/sessions.ts
import { supabase } from "./supabase";

export async function createCallRow(calleeEmail: string) {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Not authenticated');

  const { data, error: insErr } = await supabase
    .from('calls')
    .insert({ caller_id: user.id, callee_email: calleeEmail, status: 'pending' })
    .select()
    .single();

  if (insErr) throw insErr;
  return data; // { id, caller_id, callee_email, status, created_at }
}

export async function findPendingForMe() {
  // Helper to pull the newest pending call targeting me by email
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user || !user.email) return null;

  const { data, error: selErr } = await supabase
    .from('calls')
    .select('*')
    .eq('status', 'pending')
    .eq('callee_email', user.email)
    .order('created_at', { ascending: false })
    .limit(1);

  if (selErr) throw selErr;
  return data?.[0] || null;
}
