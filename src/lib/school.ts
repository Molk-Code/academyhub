// The one school this deployment serves (schools/{SCHOOL_ID}). Set per
// customer with VITE_SCHOOL_ID in .env.<customer> (vite --mode <customer>).
export const SCHOOL_ID: string = import.meta.env.VITE_SCHOOL_ID || 'molkom'
