import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/logging", () => ({
  ErrorCategory: {
    VALIDATION: "validation",
    NETWORK_RPC: "network_rpc",
  },
  logUserError: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    }),
    query: {
      explorerConfigs: {
        findFirst: () => Promise.resolve(null),
      },
    },
  },
}));

vi.mock("@/lib/db/schema", () => ({
  workflowExecutions: { id: "id", userId: "userId" },
  explorerConfigs: { id: "id", chainId: "chainId" },
}));

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
}));

vi.mock("@/lib/explorer", () => ({
  getAddressUrl: () => "https://etherscan.io/address/0x123",
}));

const mockGetChainIdFromNetwork = vi.fn();
const mockGetRpcProvider = vi.fn();

vi.mock("@/lib/rpc/network-utils", () => ({
  getChainIdFromNetwork: (...args: unknown[]) =>
    mockGetChainIdFromNetwork(...args),
}));

vi.mock("@/lib/rpc/provider-factory", () => ({
  getRpcProvider: (...args: unknown[]) => mockGetRpcProvider(...args),
  isSolanaChain: () => false,
}));

const mockContractFunction = vi.fn();
const mockStaticCall = vi.fn();

vi.mock("ethers", async () => {
  const actual = await vi.importActual<typeof import("ethers")>("ethers");
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: class MockProvider {},
      Contract: class MockContract {
        constructor() {
          return new Proxy(
            {},
            {
              get(_target: object, _prop: string | symbol): unknown {
                const fn = (...args: unknown[]) =>
                  mockContractFunction(...args);
                fn.staticCall = (...args: unknown[]) => mockStaticCall(...args);
                return fn;
              },
            }
          );
        }
      },
    },
  };
});

import type { ReadContractCoreInput } from "@/plugins/web3/steps/read-contract-core";
import { readContractCore } from "@/plugins/web3/steps/read-contract-core";

const VALID_ADDRESS = "0x6B175474E89094C44Da98b954EedeAC495271d0F";

const VIEW_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
];

const PURE_ABI = [
  {
    name: "add",
    type: "function",
    stateMutability: "pure",
    inputs: [
      { name: "a", type: "uint256" },
      { name: "b", type: "uint256" },
    ],
    outputs: [{ name: "result", type: "uint256" }],
  },
];

const NONPAYABLE_ABI = [
  {
    name: "quoteExactInputSingle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "amountIn", type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
];

function makeInput(
  overrides: Partial<ReadContractCoreInput> = {}
): ReadContractCoreInput {
  return {
    contractAddress: VALID_ADDRESS,
    network: "ethereum",
    abi: JSON.stringify(VIEW_ABI),
    abiFunction: "balanceOf",
    functionArgs: JSON.stringify([VALID_ADDRESS]),
    ...overrides,
  };
}

function setupRpcMocks(): void {
  mockGetChainIdFromNetwork.mockReturnValue(1);
  mockGetRpcProvider.mockResolvedValue({
    executeWithFailover: (fn: (provider: unknown) => unknown) =>
      fn(new (class MockProvider {})()),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("read-contract-core - staticCall for non-view functions", () => {
  it("calls function directly for view stateMutability", async () => {
    setupRpcMocks();
    mockContractFunction.mockResolvedValueOnce(BigInt("1000"));

    const result = await readContractCore(makeInput());

    expect(result.success).toBe(true);
    expect(mockContractFunction).toHaveBeenCalledOnce();
    expect(mockStaticCall).not.toHaveBeenCalled();
  });

  it("calls function directly for pure stateMutability", async () => {
    setupRpcMocks();
    mockContractFunction.mockResolvedValueOnce(BigInt("42"));

    const result = await readContractCore(
      makeInput({
        abi: JSON.stringify(PURE_ABI),
        abiFunction: "add",
        functionArgs: JSON.stringify(["10", "32"]),
      })
    );

    expect(result.success).toBe(true);
    expect(mockContractFunction).toHaveBeenCalledOnce();
    expect(mockStaticCall).not.toHaveBeenCalled();
  });

  it("uses staticCall for nonpayable stateMutability", async () => {
    setupRpcMocks();
    mockStaticCall.mockResolvedValueOnce(BigInt("500000"));

    const result = await readContractCore(
      makeInput({
        abi: JSON.stringify(NONPAYABLE_ABI),
        abiFunction: "quoteExactInputSingle",
        functionArgs: JSON.stringify([
          VALID_ADDRESS,
          VALID_ADDRESS,
          "3000",
          "1000000",
          "0",
        ]),
      })
    );

    expect(result.success).toBe(true);
    expect(mockStaticCall).toHaveBeenCalledOnce();
    expect(mockContractFunction).not.toHaveBeenCalled();
  });

  it("uses staticCall for payable stateMutability", async () => {
    setupRpcMocks();

    const payableAbi = [
      {
        name: "deposit",
        type: "function",
        stateMutability: "payable",
        inputs: [],
        outputs: [{ name: "shares", type: "uint256" }],
      },
    ];

    mockStaticCall.mockResolvedValueOnce(BigInt("100"));

    const result = await readContractCore(
      makeInput({
        abi: JSON.stringify(payableAbi),
        abiFunction: "deposit",
        functionArgs: undefined,
      })
    );

    expect(result.success).toBe(true);
    expect(mockStaticCall).toHaveBeenCalledOnce();
    expect(mockContractFunction).not.toHaveBeenCalled();
  });

  it("returns structured output from staticCall result", async () => {
    setupRpcMocks();
    mockStaticCall.mockResolvedValueOnce(BigInt("999"));

    const result = await readContractCore(
      makeInput({
        abi: JSON.stringify(NONPAYABLE_ABI),
        abiFunction: "quoteExactInputSingle",
        functionArgs: JSON.stringify([
          VALID_ADDRESS,
          VALID_ADDRESS,
          "3000",
          "1000000",
          "0",
        ]),
      })
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toEqual({ amountOut: "999" });
    }
  });
});
