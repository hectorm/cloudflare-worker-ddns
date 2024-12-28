// Dynamic DNS update service for Cloudflare Workers as specified by DynDNS API:
// https://help.dyn.com/remote-access-api/perform-update/

/**
 * Cloudflare API endpoint URL.
 * @see https://developers.cloudflare.com/api
 * @type {string}
 */
const CF_API_ENDPOINT = "https://api.cloudflare.com/client/v4";

// NOTE FOR READERS: Cloudflare Workers KV can be used to cache the zone and record IDs for faster lookups,
// but since this service is not intended to receive a high volume of requests, in-memory caching is used
// instead for simplicity.

/**
 * Zone ID cache.
 * @type {Map<string, string>}
 */
const ZONE_ID_CACHE = new Map();

/**
 * Record ID cache.
 * @type {Map<string, string>}
 */
const RECORD_ID_CACHE = new Map();

/**
 * Retrieves the zone ID.
 * @param {string} apiToken Cloudflare API token.
 * @param {string} zoneName The name of the zone to retrieve the ID for.
 * @returns {Promise<string|null>} The zone ID or null if not found.
 * @throws {Error} If the zone fetch fails.
 */
const getZoneId = async (apiToken, zoneName) => {
  const cacheKey = zoneName;
  const cachedZoneId = ZONE_ID_CACHE.get(cacheKey);
  if (cachedZoneId) {
    console.debug(`Zone ID cache hit: ${zoneName} -> ${cachedZoneId}`);
    return cachedZoneId;
  }

  const url = new URL(`${CF_API_ENDPOINT}/zones`);
  url.searchParams.set("name", zoneName);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch zone: ${zoneName} -> ${response.statusText}`);
  }

  const data = await response.json();
  const zoneId = data?.result?.[0]?.id;
  if (zoneId) {
    ZONE_ID_CACHE.set(cacheKey, zoneId);
  }

  return zoneId ?? null;
};

/**
 * Retrieves the record ID.
 * @param {string} apiToken Cloudflare API token.
 * @param {string} zoneId The zone ID.
 * @param {string} recordName The record name.
 * @param {string} recordType The record type (A or AAAA).
 * @returns {Promise<string|null>} The record ID or null if not found.
 * @throws {Error} If the record fetch fails.
 */
const getRecordId = async (apiToken, zoneId, recordName, recordType) => {
  const cacheKey = `${zoneId}:${recordName}:${recordType}`;
  const cachedRecordId = RECORD_ID_CACHE.get(cacheKey);
  if (cachedRecordId) {
    console.debug(`Record ID cache hit: ${recordName} (${recordType}) -> ${cachedRecordId}`);
    return cachedRecordId;
  }

  const url = new URL(`${CF_API_ENDPOINT}/zones/${zoneId}/dns_records`);
  url.searchParams.set("name", recordName);
  url.searchParams.set("type", recordType);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch record: ${recordName} (${recordType}) -> ${response.statusText}`);
  }

  const data = await response.json();
  const recordId = data?.result?.[0]?.id;
  if (recordId) {
    RECORD_ID_CACHE.set(cacheKey, recordId);
  }

  return recordId ?? null;
};

/**
 * Updates the record with the new IP address.
 * @param {string} apiToken Cloudflare API token.
 * @param {string} zoneId The zone ID.
 * @param {string} recordId The record ID.
 * @param {string} recordName The record name.
 * @param {string} recordType The record type (A or AAAA).
 * @param {string} recordIp The new IP address.
 * @returns {Promise<boolean>} `true` if the record was updated, else `false`.
 * @throws {Error} If the record update fails.
 */
const updateRecord = async (apiToken, zoneId, recordId, recordName, recordType, recordIp) => {
  const url = new URL(`${CF_API_ENDPOINT}/zones/${zoneId}/dns_records/${recordId}`);

  const currentRecordResponse = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!currentRecordResponse.ok) {
    throw new Error(`Failed to fetch record: ${recordName} (${recordType}) -> ${currentRecordResponse.statusText}`);
  }

  const currentRecordData = await currentRecordResponse.json();
  if (currentRecordData?.result?.content?.toLowerCase() === recordIp) {
    console.info(`Record already up-to-date: ${recordName} (${recordType}) -> ${recordIp}`);
    return false;
  }

  const updateRecordResponse = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: recordName,
      type: recordType,
      content: recordIp,
      ttl: currentRecordData?.result?.ttl ?? 1,
      proxied: currentRecordData?.result?.proxied ?? false,
      comment: currentRecordData?.result?.comment ?? "",
      tags: currentRecordData?.result?.tags ?? [],
    }),
  });
  if (!updateRecordResponse.ok) {
    throw new Error(`Failed to update record: ${recordName} (${recordType}) -> ${updateRecordResponse.statusText}`);
  }

  return true;
};

/**
 * Timing-safe string comparison to prevent timing attacks.
 * @param {string} a First string.
 * @param {string} b Second string.
 * @returns {boolean} `true` if strings are equal, else `false`.
 */
const timingSafeEqual = (a, b) => {
  let mismatch = a.length ^ b.length;
  const maxLength = Math.max(a.length, b.length);
  for (let i = 0; i < maxLength; i++) {
    const aChar = i < a.length ? a.charCodeAt(i) : 0;
    const bChar = i < b.length ? b.charCodeAt(i) : 0;
    mismatch |= aChar ^ bChar;
  }
  return mismatch === 0;
};

/**
 * Custom Response class for DDNS responses.
 * @extends Response
 */
class DDNSResponse extends Response {
  /**
   * @param {number} status The HTTP status code.
   * @param {string} message The response message.
   */
  constructor(status, message) {
    super(message, {
      status,
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        "Cache-Control": "no-store",
      },
    });
  }
}

/**
 * Custom Error class for DDNS errors.
 * @extends Error
 * @property {string} code The error code.
 */
class DDNSError extends Error {
  /**
   * @param {string} code The error code.
   * @param {string} message The error message.
   */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export default {
  /**
   * Fetch event handler.
   * @param {Request} request The incoming request.
   * @param {{[key: string]: string}} env The environment variables.
   * @param {unknown} ctx The context object.
   * @returns {Promise<DDNSResponse>} The DDNS response.
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== "/nic/update") {
      console.error("Invalid request path");
      return new Response(null, { status: 404 });
    }

    if (!["GET", "HEAD", "POST"].includes(request.method)) {
      console.error("Invalid request method");
      return new DDNSResponse(405, "badagent");
    }

    const ddnsUsername = env.DDNS_USERNAME;
    const ddnsPassword = env.DDNS_PASSWORD;
    if (!ddnsUsername || !ddnsPassword) {
      console.error("Missing DDNS_USERNAME and/or DDNS_PASSWORD variables");
      return new DDNSResponse(500, "911");
    }

    const authReceived = request.headers.get("Authorization") ?? "";
    const authExpected = `Basic ${btoa(`${ddnsUsername}:${ddnsPassword}`)}`;
    if (!timingSafeEqual(authReceived, authExpected)) {
      console.error("Invalid request credentials");
      return new DDNSResponse(401, "badauth");
    }

    const recordNames = url.searchParams.get("hostname")?.toLowerCase().split(",");
    const recordIps = (url.searchParams.get("myip") ?? request.headers.get("CF-Connecting-IP"))?.toLowerCase().split(",");
    if (!recordNames || !recordIps) {
      console.error("Missing request parameters");
      return new DDNSResponse(400, "badagent");
    }

    const recordAllowlist = env.DDNS_RECORD_ALLOWLIST?.toLowerCase().split(",");
    if (recordAllowlist && recordNames.some((r) => !recordAllowlist.includes(r))) {
      console.error("Record not allowed");
      return new DDNSResponse(403, "abuse");
    }

    const apiToken = env.CF_API_TOKEN;
    if (!apiToken) {
      console.error("Missing CF_API_TOKEN variable");
      return new DDNSResponse(500, "911");
    }

    const recordUpdates = [];
    for (const recordName of recordNames) {
      try {
        let zoneId;
        const recordNameParts = recordName.split(".");
        for (let i = recordNameParts.length - 2; i >= 0; i--) {
          const zoneName = recordNameParts.slice(i).join(".");
          try {
            console.debug(`Fetching zone: ${zoneName}`);
            zoneId = await getZoneId(apiToken, zoneName);
          } catch (/** @type {any} */ error) {
            throw new DDNSError("911", error?.message);
          }
          if (zoneId) break;
        }
        if (!zoneId) {
          throw new DDNSError("nohost", `Zone not found for record: ${recordName}`);
        }

        let recordUpdateCount = 0;
        for (const recordIp of recordIps) {
          const recordType = recordIp.includes(":") ? "AAAA" : "A";

          let recordId;
          try {
            console.debug(`Fetching record: ${recordName} (${recordType})`);
            recordId = await getRecordId(apiToken, zoneId, recordName, recordType);
          } catch (/** @type {any} */ error) {
            throw new DDNSError("911", error?.message);
          }
          if (!recordId) {
            throw new DDNSError("nohost", `Record not found: ${recordName} (${recordType})`);
          }

          let recordUpdated;
          try {
            console.debug(`Updating record: ${recordName} (${recordType}) -> ${recordIp}`);
            recordUpdated = await updateRecord(apiToken, zoneId, recordId, recordName, recordType, recordIp);
          } catch (/** @type {any} */ error) {
            throw new DDNSError("911", error?.message);
          }
          if (recordUpdated) {
            recordUpdateCount++;
          }
        }

        recordUpdates.push(`${recordUpdateCount > 0 ? "good" : "nochg"} ${recordIps.join(",")}`);
      } catch (/** @type {any} */ error) {
        console.error(error?.message);
        recordUpdates.push(error instanceof DDNSError ? error.code : "911");
      }
    }

    const recordBadUpdates = recordUpdates.filter((r) => !/^(good|nochg) /.test(r));
    if (recordBadUpdates.length > 0) {
      console.error(`Failed to update ${recordBadUpdates.length} out of ${recordUpdates.length} record(s)`);
      return new DDNSResponse(500, recordUpdates.join("\n"));
    }

    console.info(`Updated ${recordUpdates.length} record(s)`);
    return new DDNSResponse(200, recordUpdates.join("\n"));
  },
};
