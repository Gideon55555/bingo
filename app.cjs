// Startup file for shared hosting (DirectAdmin / cPanel "Setup Node.js App", Phusion Passenger).
// Passenger loads apps with require(), and this project uses ES modules, so we load it via import().
import('./server/index.js').catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
