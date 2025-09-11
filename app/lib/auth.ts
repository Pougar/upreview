import { betterAuth } from "better-auth";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true }, // adjust if your DB requires strict SSL
});
export const auth = betterAuth({
    database: pool,
    emailAndPassword: {
        enabled: true, 
    }
    /*socialProviders: {
        //If I wanted to add Google or (perhaps Xero) as a way to sign in and log in
    }, */
})