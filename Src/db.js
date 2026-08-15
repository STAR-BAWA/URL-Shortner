import postgres from "postgres";

console.log("DATABASE_URL:", process.env.DATABASE_URL);

const sql = postgres(process.env.DATABASE_URL);

export default sql;