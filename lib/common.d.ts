declare namespace common {
  function hashPassword(password: string): Promise<string>;
  function validatePassword(
    password: string,
    serHash: string,
  ): Promise<boolean>;
}
