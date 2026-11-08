// Prints the 75 bingo calls (Amharic text) as JSON, for the voice generators.
import { ALL_CALLS } from '../../shared/amharic-calls.js';
process.stdout.write(JSON.stringify(ALL_CALLS, null, 1));
