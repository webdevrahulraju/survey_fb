import * as crypto from "crypto";

const USERNAME_LENGTH = 6;
const PASSWORD_LENGTH = 10;

export interface GeneratedCredentials {
  username: string;
  email: string;
  password: string;
}

/**
 * Generate a random alphanumeric username like "survey-a3f8x2"
 * and a strong random password.
 * @return {GeneratedCredentials} Generated username, email, and password.
 */
export function generateCredentials(): GeneratedCredentials {
  const usernameChars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const suffix = randomString(USERNAME_LENGTH, usernameChars);
  const username = `survey-${suffix}`;
  const email = `${username}@survey.delight.ae`;

  const password = generatePassword(PASSWORD_LENGTH);

  return {username, email, password};
}

/**
 * Generate a random password with at least one uppercase,
 * one lowercase, one digit, and one symbol.
 * @param {number} length - Desired password length.
 * @return {string} Generated password.
 */
function generatePassword(length: number): string {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const symbols = "#@!$%&*?";
  const all = upper + lower + digits + symbols;

  // Guarantee at least one of each category.
  const mandatory = [
    randomString(1, upper),
    randomString(1, lower),
    randomString(1, digits),
    randomString(1, symbols),
  ];

  const remaining = randomString(length - mandatory.length, all);
  const combined = mandatory.join("") + remaining;

  // Shuffle to avoid predictable positions.
  return shuffle(combined);
}

/**
 * Generate a random string of given length from the character set.
 * @param {number} length - Number of characters.
 * @param {string} charset - Character pool to pick from.
 * @return {string} Random string.
 */
function randomString(length: number, charset: string): string {
  const bytes = crypto.randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += charset[bytes[i] % charset.length];
  }
  return result;
}

/**
 * Fisher-Yates shuffle of a string.
 * @param {string} str - String to shuffle.
 * @return {string} Shuffled string.
 */
function shuffle(str: string): string {
  const arr = str.split("");
  const bytes = crypto.randomBytes(arr.length);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = bytes[i] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join("");
}
