import { ClientRequest } from 'node:http';

declare namespace common {
  function hashPassword(password: string): Promise<string>;
  function validatePassword(
    password: string,
    serHash: string,
  ): Promise<boolean>;
  function jsonParse(buffer: Buffer): object | null;
  function receiveBody(req: ClientRequest): Promise<string>;
}
