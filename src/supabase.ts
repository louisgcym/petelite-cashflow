import { createClient } from '@supabase/supabase-js';

const url = 'https://wxwgsufzqkgidosbahdu.supabase.co';
const key = 'sb_publishable_AJGWMF2AwNmiK0c90OY42g_d6tp-JCU';

export const supabase = createClient(url, key);
