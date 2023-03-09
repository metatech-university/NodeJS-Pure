declare namespace crypto {
  function cryptoRandom(): number;
  function generateUUID(): string;
  function hashPassword(password: string): Promise<string>;
  function validatePassword(password: string, serHash: string): Promise<boolean>;
}
