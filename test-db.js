require('dotenv').config();
const { supabase } = require('./src/shared/db');
async function run() {
    const { data, error } = await supabase.from('tasks').select('title, created_at').order('created_at', { ascending: false }).limit(20);
    console.log(data);
}
run();
