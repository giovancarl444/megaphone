// CJS shim required into the supervisor to capture WHY it exits.
const fs = require('fs');
const log = (m) => fs.appendFileSync('D:/megaphone/.exitprobe.log', `[${new Date().toISOString()}] ${m}\n`);
log('probe loaded');
process.on('exit', (code) => log(`EXIT code=${code} (note: cannot run async here)`));
process.on('beforeExit', (code) => log(`BEFOREEXIT code=${code} stack=${new Error('beforeExit').stack}`));
process.on('uncaughtException', (e) => { log(`UNCAUGHT ${e && e.stack || e}`); });
process.on('unhandledRejection', (r) => { log(`UNHANDLED_REJECTION ${r && r.stack || r}`); });
for (const s of ['SIGINT','SIGTERM','SIGHUP','SIGQUIT','SIGKILL']) {
  process.on(s, (sig) => { log(`RECEIVED ${sig}`); });
}
