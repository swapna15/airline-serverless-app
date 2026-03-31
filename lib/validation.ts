/** 3-character uppercase IATA airport code */
export function isValidIATA(code: string): boolean {
  return /^[A-Z]{3}$/.test(code);
}

/** YYYY-MM-DD date format */
export function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

/** HH:MM 24-hour time format */
export function isValidTime(time: string): boolean {
  return /^\d{2}:\d{2}$/.test(time);
}

/** Simplified RFC 5322 email validation */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Non-empty string, max 100 characters */
export function isValidName(name: string): boolean {
  return typeof name === "string" && name.trim().length > 0 && name.trim().length <= 100;
}
