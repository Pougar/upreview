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
    },
        trustedOrigins: [
        "http://localhost:3000", // local dev
        "*.vercel.app",        // regex: matches all preview deployments
        "https://your-production-domain.com" // your prod domain
        ],
    socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      accessType: "offline",                 // get refresh token
      prompt: "select_account consent",
      // Optional: request GBP scope up front
      scopes: ["https://www.googleapis.com/auth/business.manage"],
    },
  },
})