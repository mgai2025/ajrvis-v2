require('dotenv').config();
const { supabase } = require('./src/shared/db');

async function checkUser() {
    const { data } = await supabase.from('users').select('*').eq('phone', 'TG-420240189');
    console.log(data);
    process.exit(0);
}
checkUser();
