import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { ENV } from "../config.js";

let supabase: SupabaseClient | null = null;

/**
 * Returns the Supabase client, or null if not configured.
 * Graceful degradation: memory tiers are disabled when Supabase is unavailable.
 */
export function getSupabase(): SupabaseClient | null {
  if (supabase) return supabase;

  if (!ENV.SUPABASE_URL || !ENV.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  try {
    supabase = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY);
    console.log("[Supabase] Client initialized.");
    return supabase;
  } catch (err) {
    console.error("[Supabase] Failed to initialize:", err);
    return null;
  }
}

/**
 * Check if Supabase is available and working.
 */
export async function isSupabaseReady(): Promise<boolean> {
  const client = getSupabase();
  if (!client) return false;

  try {
    // Test the connection with a simple query
    const { error } = await client.from("core_memories").select("key").limit(1);
    if (error) {
      console.warn("[Supabase] Connection test failed:", error.message);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
