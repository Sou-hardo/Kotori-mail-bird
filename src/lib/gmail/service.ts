import type { gmail_v1 } from "googleapis";
import { authorizedGmail } from "@/lib/gmail/connection";
export {
  isGmailHistoryExpired,
  isRetryableGmailError,
} from "@/lib/gmail/errors";

export type GmailApi = Pick<gmail_v1.Gmail, "users">;

export async function getGmailService(connectionId: string): Promise<GmailApi> {
  return (await authorizedGmail(connectionId)).gmail;
}
