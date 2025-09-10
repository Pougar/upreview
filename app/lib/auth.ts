import { betterAuth } from "better-auth";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

export const auth = betterAuth({
    database: sql,
    emailAndPassword: {
        enabled: true, 
    }
    /*socialProviders: {
        //If I wanted to add Google or (perhaps Xero) as a way to sign in and log in
    }, */
})