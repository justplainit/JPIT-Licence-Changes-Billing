/**
 * Parser for Cloud-iQ (Crayon) email notification text.
 *
 * Expected format (one or more blocks):
 *   Time: ...
 *   Event: ...
 *   Changed by: ...
 *   Organization: ...
 *   Cloud Account: ...
 *   Domain: ...
 *   Subscription Name: ...
 *   Product: ...
 *   Quantity of licenses: ...
 *   Subscription Id: ...
 */

export interface CloudIQNotification {
  time: string;
  event: string;
  changedBy: string;
  organization: string;
  cloudAccount: string;
  domain: string;
  subscriptionName: string;
  product: string;
  quantity: number;
  subscriptionId: string;
}

const FIELD_MAP: Record<string, keyof CloudIQNotification> = {
  "time": "time",
  "event": "event",
  "changed by": "changedBy",
  "organization": "organization",
  "cloud account": "cloudAccount",
  "domain": "domain",
  "subscription name": "subscriptionName",
  "product": "product",
  "quantity of licenses": "quantity",
  "subscription id": "subscriptionId",
};

/**
 * Parse the text content of a Cloud-iQ change notification email.
 * Supports pasting of one or more notification blocks.
 */
export function parseCloudIQNotification(text: string): CloudIQNotification[] {
  const results: CloudIQNotification[] = [];

  // Split into blocks by looking for "Time:" as a delimiter for each notification
  // First, normalise line breaks
  const normalised = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Split on "Time:" to get individual notification blocks
  const blocks = normalised.split(/(?=Time:\s)/i).filter((b) => b.trim());

  for (const block of blocks) {
    const notification = parseBlock(block);
    if (notification) {
      results.push(notification);
    }
  }

  return results;
}

function parseBlock(block: string): CloudIQNotification | null {
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);

  const fields: Record<string, string> = {};

  for (const line of lines) {
    // Match "Key: Value" pattern
    const match = line.match(/^([^:]+):\s*(.+)$/);
    if (!match) continue;

    const rawKey = match[1].trim().toLowerCase();
    const value = match[2].trim();

    const fieldKey = FIELD_MAP[rawKey];
    if (fieldKey) {
      fields[fieldKey] = value;
    }
  }

  // Must have at least subscription ID or product + quantity to be useful
  if (!fields.subscriptionId && !fields.product) {
    return null;
  }

  return {
    time: fields.time || "",
    event: fields.event || "",
    changedBy: fields.changedBy || "",
    organization: fields.organization || "",
    cloudAccount: fields.cloudAccount || "",
    domain: fields.domain || "",
    subscriptionName: fields.subscriptionName || "",
    product: fields.product || "",
    quantity: parseInt(fields.quantity || "0", 10),
    subscriptionId: fields.subscriptionId || "",
  };
}
