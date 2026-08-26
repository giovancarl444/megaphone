/** Pump.fun coin shape (subset of the 46-field v3 schema we actually use). */
export interface Coin {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  creator: string;
  username?: string | null;
  profile_image?: string | null;
  created_timestamp: number; // ms
  complete: boolean; // bonding curve complete (graduated)
  is_banned: boolean;
  nsfw: boolean;
  verified: boolean;
  market_cap: number; // SOL
  market_cap_usd: number;
  usd_market_cap: number;
  reply_count: number;
  last_trade_timestamp?: number | null;
  twitter?: string | null;
  telegram?: string | null;
  website?: string | null;
  // bonding curve internals
  virtual_sol_reserves: number;
  virtual_token_reserves: number;
  real_token_reserves: number;
  real_sol_reserves: number; // actual SOL deposited by real buyers
  total_supply: number;
  // reserved for future: volume arrives via trades, not coins list
  volume_24h_usd?: number | null;
}

export interface ScoreResult {
  mint: string;
  symbol: string;
  name: string;
  pass: boolean;
  score: number; // 0-100
  reasons: string[]; // why it passed / failed
  createdAgoSec: number;
  mcUsd: number;
  socials: string[];
}
