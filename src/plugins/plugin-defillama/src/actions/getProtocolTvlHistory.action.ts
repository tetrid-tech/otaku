import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
  logger,
} from "@elizaos/core";
import {
  DefiLlamaService,
  type ProtocolLookupResult,
  type ProtocolSummary,
  type ProtocolTvlHistory,
  type ProtocolTvlPoint,
} from "../services/defillama.service";

const MAX_SERIES_DEFAULT = 365;

export const getProtocolTvlHistoryAction: Action = {
  name: "GET_PROTOCOL_TVL_HISTORY",
  similes: [
    "PROTOCOL_TVL_HISTORY",
    "DEFI_TVL_HISTORY",
    "TVL_TREND",
    "PROTOCOL_TVL_CHART",
  ],
  description:
    "Fetch historical TVL data for a specific DeFi protocol, with optional per-chain breakdown and lookback window.",
  parameters: {
    protocol: {
      type: "string",
      description: "Protocol name or symbol (e.g., 'Aave', 'Curve').",
      required: true,
    },
    chain: {
      type: "string",
      description: "Optional chain name to return a focused breakdown (e.g., 'Ethereum').",
      required: false,
    },
    days: {
      type: "number",
      description: "Optional number of most recent days to include (default 365).",
      required: false,
    },
  },
  validate: async (runtime: IAgentRuntime): Promise<boolean> => {
    const svc = runtime.getService(DefiLlamaService.serviceType) as DefiLlamaService | undefined;
    if (!svc) {
      logger.error("DefiLlamaService not available");
      return false;
    }
    return true;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, never>,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      const svc = runtime.getService(DefiLlamaService.serviceType) as DefiLlamaService | undefined;
      if (!svc) {
        throw new Error("DefiLlamaService not available");
      }

      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = composedState?.data?.actionParams ?? {};

      const protocolParam = typeof params?.protocol === "string" ? params.protocol.trim() : "";
      if (!protocolParam) {
        const errorMsg = "Missing required parameter 'protocol'.";
        logger.error(`[GET_PROTOCOL_TVL_HISTORY] ${errorMsg}`);
        return await respondWithError(callback, errorMsg, "missing_required_parameter");
      }

      const chainParamRaw = typeof params?.chain === "string" ? params.chain.trim() : "";
      const chainParam = chainParamRaw || undefined;

      const daysParamRaw = params?.days;
      const parsedDays = parsePositiveInteger(daysParamRaw);
      const limitDays = parsedDays ?? MAX_SERIES_DEFAULT;

      const lookupResults = await svc.getProtocolsByNames([protocolParam]);
      const match = lookupResults.find(
        (result): result is ProtocolLookupResult & { data: ProtocolSummary } => Boolean(result.success && result.data),
      );

      if (!match || !match.data) {
        const errorMsg = `No protocol match found for '${protocolParam}'.`;
        logger.error(`[GET_PROTOCOL_TVL_HISTORY] ${errorMsg}`);
        return await respondWithError(callback, errorMsg, "no_protocol_match");
      }

      const slugCandidate = determineSlug(match.data);
      if (!slugCandidate) {
        const errorMsg = `Unable to resolve protocol slug for '${match.data.name}'.`;
        logger.error(`[GET_PROTOCOL_TVL_HISTORY] ${errorMsg}`);
        return await respondWithError(callback, errorMsg, "missing_protocol_slug");
      }

      logger.info(
        `[GET_PROTOCOL_TVL_HISTORY] Fetching history for slug='${slugCandidate}' (protocol='${match.data.name}')`,
      );

      const history = await svc.getProtocolTvlHistory(slugCandidate);
      const limitedTotalSeries = limitSeries(history.totalSeries, limitDays);

      if (limitedTotalSeries.length === 0) {
        const errorMsg = `No TVL history data returned for '${match.data.name}'.`;
        logger.warn(`[GET_PROTOCOL_TVL_HISTORY] ${errorMsg}`);
        return await respondWithError(callback, errorMsg, "empty_series", {
          protocol: match.data.name,
        });
      }

      const limitedChainSeries = buildChainSeries(history, chainParam, limitDays);

      const messageText = chainParam
        ? buildChainMessage(match.data.name, limitedTotalSeries.length, chainParam, limitedChainSeries)
        : `Retrieved ${limitedTotalSeries.length} TVL data points for ${match.data.name}.`;

      const responsePayload = {
        protocol: {
          name: history.name,
          slug: history.slug,
          symbol: history.symbol,
          currentTvl: history.currentTvl,
          lastUpdated: history.lastUpdated,
        },
        totalSeries: limitedTotalSeries,
        chainSeries: limitedChainSeries,
        meta: {
          totalPoints: limitedTotalSeries.length,
          requestedDays: parsedDays,
        },
      } satisfies ProtocolHistoryResponse;

      if (callback) {
        await callback({
          text: messageText,
          actions: ["GET_PROTOCOL_TVL_HISTORY"],
          content: responsePayload,
          source: message.content.source,
        });
      }

      return {
        text: messageText,
        success: true,
        data: responsePayload,
        input: {
          protocol: protocolParam,
          chain: chainParam,
          days: parsedDays,
        },
      } as ActionResult & {
        input: {
          protocol: string;
          chain?: string;
          days?: number;
        };
      };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_PROTOCOL_TVL_HISTORY] Action failed: ${messageText}`);
      return await respondWithError(callback, `Failed to fetch protocol TVL history: ${messageText}`, "action_failed");
    }
  },
  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "Show TVL history for Aave" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Retrieved 365 TVL data points for Aave.",
          actions: ["GET_PROTOCOL_TVL_HISTORY"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "Give me Curve's Ethereum TVL trend over the last 90 days" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Retrieved 90 TVL data points for Curve DEX on Ethereum.",
          actions: ["GET_PROTOCOL_TVL_HISTORY"],
        },
      },
    ],
  ],
};

type ProtocolHistoryResponse = {
  protocol: {
    name: string;
    slug: string;
    symbol: string | null;
    currentTvl: number | null;
    lastUpdated: number | null;
  };
  totalSeries: ProtocolTvlPoint[];
  chainSeries: Record<string, ProtocolTvlPoint[]>;
  meta: {
    totalPoints: number;
    requestedDays?: number | null;
  };
};

function parsePositiveInteger(value: string | number | null | undefined): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

function determineSlug(summary: ProtocolSummary): string | undefined {
  if (summary.slug && summary.slug.trim()) {
    return summary.slug.trim();
  }
  const slugified = summary.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slugified || undefined;
}

function limitSeries(series: ProtocolTvlPoint[], limit: number): ProtocolTvlPoint[] {
  if (!limit || series.length <= limit) {
    return series;
  }
  return series.slice(series.length - limit);
}

function buildChainSeries(
  history: ProtocolTvlHistory,
  chain: string | undefined,
  limit: number,
): Record<string, ProtocolTvlPoint[]> {
  const chainSeries: Record<string, ProtocolTvlPoint[]> = {};
  if (!chain) {
    for (const [chainName, series] of Object.entries(history.chainSeries)) {
      chainSeries[chainName] = limitSeries(series, limit);
    }
    return chainSeries;
  }

  const chainLookup = chain.toLowerCase();
  const matched = Object.entries(history.chainSeries).find(([chainName]) => chainName.toLowerCase() === chainLookup);
  if (matched) {
    chainSeries[matched[0]] = limitSeries(matched[1], limit);
  }
  return chainSeries;
}

async function respondWithError(
  callback: HandlerCallback | undefined,
  messageText: string,
  errorCode: string,
  details?: Record<string, string | number | null>,
): Promise<ActionResult> {
  if (callback) {
    await callback({
      text: messageText,
      content: { error: errorCode, details },
    });
  }

  return {
    text: messageText,
    success: false,
    error: errorCode,
    data: details,
  };
}

function buildChainMessage(
  protocolName: string,
  totalPoints: number,
  requestedChain: string,
  chainSeries: Record<string, ProtocolTvlPoint[]>,
): string {
  const chainKeys = Object.keys(chainSeries);
  if (chainKeys.length === 0) {
    return `Retrieved ${totalPoints} TVL data points for ${protocolName}, but no chain breakdown matched '${requestedChain}'.`;
  }
  return `Retrieved ${totalPoints} TVL data points for ${protocolName} on ${chainKeys.join(", ")}.`;
}


