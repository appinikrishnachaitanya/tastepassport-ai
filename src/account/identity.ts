export function accountName(value: unknown): string {
  if (typeof value !== "string") throw Error("Enter your first and last name.");
  const name = value.trim().normalize("NFC");
  if (!name || name.length > 80 || !/\p{L}/u.test(name) || !/^[\p{L}\p{M} .’'\-]+$/u.test(name))
    throw Error("Use a name of up to 80 characters, without contact details.");
  return name;
}
