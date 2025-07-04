import { createSelector } from "@reduxjs/toolkit";
import { StateSchema } from "@/shared/types/store";

export const isMarketsInited = (state: StateSchema) => state.markets.__inited;

const selectMarketsData = (state: StateSchema) => state.markets.data;

export const getMarketsData = (exchange: string) =>
  createSelector([selectMarketsData], (markets) => markets[exchange] ?? null);
