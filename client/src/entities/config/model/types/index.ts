import { Exchange, TesterDefaultArgs } from '@packages/types';

export type EngineMode = "realtime" | "tester" | "both";

export interface ConfigStateSchema {
  exchangeList: Exchange[];
  engineVersion: string | null;
  engineMode: EngineMode | null;
  s3Host: string | null;
  testerDefaults: TesterDefaultArgs | null;
  __inited: boolean;
}
