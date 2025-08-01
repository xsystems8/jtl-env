import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Runtime as PrismaRuntime, Scenario as PrismaScenario } from '@prisma/client';
import { ScriptArtifactsService } from '../artifacts/script-artifacts.service';
import { nanoid } from 'nanoid';
import { StrategyItem, StrategyItemType } from '../types';
import { Strategy as ServerResponseStrategy, StrategyDefinedArg } from '@packages/types';
import { parseDefinedArgs } from '../utils/parse-defined-args';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../../common/prisma/prisma.service';

type Runtime = {
  id?: number;
  accountId: string;
  name: string;
  prefix: string;
  strategyId: string;
  strategyType: string;
  runtimeType: string;
  strategy: StrategyItem;
  artifacts: string;
  exchange: string;
  args: KeyValueType[] | string;
  createdAt?: Date;
  updatedAt?: Date;
};
type Scenario = Omit<PrismaScenario, 'strategy' | 'strategyId' | 'strategyType'> & { strategy: StrategyItem };
type KeyValueType = { key: string; value: string | number };
export type StrategyTypeDTO = {
  id?: number;
  accountId: string;
  name: string;
  prefix: string;
  strategy: string;
  strategyId: string;
  strategyType: StrategyItemType;
  strategyPath?: string;
  exchange?: string;
  runtimeType: 'market' | 'system';
  args: KeyValueType[] | string;
};

@Injectable()
export class ScriptStorageService {
  public sourcePath: string;

  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(ScriptStorageService.name) private readonly logger: PinoLogger,
  ) {
    this.sourcePath = process.env.STRATEGY_FILES_PATH;
  }

  getContent = (strategyPath: string): { strategy: string; content: string } => {
    return {
      strategy: strategyPath,
      content: fs.readFileSync(path.join(this.sourcePath, ...strategyPath.split('/'))).toString(),
    };
  };

  getStrategies = (): ServerResponseStrategy[] => {
    const rootFiles = fs
      .readdirSync(this.sourcePath)
      .filter((item) => /\w+\.js$|\.ts$/.test(item))
      .map((filename) => ({ filename, path: [filename] }));
    let exampleFiles = [];

    if (process.env.ENGINE_MODE === 'both' && fs.existsSync(path.join(this.sourcePath, 'examples'))) {
      exampleFiles = fs
        .readdirSync(path.join(this.sourcePath, 'examples'))
        .filter((item) => /\w+\.js$|\.ts$/.test(item))
        .map((filename) => ({ filename, path: ['examples', filename] }));
    }

    const files = [...rootFiles, ...exampleFiles];

    return files.map((file) => {
      const content = fs.readFileSync(path.join(this.sourcePath, ...file.path), { encoding: 'utf-8' });
      let definedArgs: StrategyDefinedArg[] | null;

      try {
        definedArgs = parseDefinedArgs(content, file.filename.endsWith('.ts'));
      } catch (e) {
        this.logger.warn(
          { message: e.message, stack: e.stack?.split("\n") },
          `an error occurred while parsing definedArgs (${file.filename})`,
        );
      }

      const strategyName = file.filename.replace(/\.js|\.ts/g, '');

      return {
        id: strategyName,
        name: strategyName,
        path: file.path.join('/'),
        type: 'local',
        definedArgs,
        mode: 'runtime',
      };
    });
  };

  getRuntimeList = async (accountId: string): Promise<Runtime[]> => {
    return (await this.prisma.runtime.findMany({ where: { accountId } })).map((item) => {
      return this.formatRuntime(item as StrategyTypeDTO);
    });
  };

  getRuntimeById = async (id: number): Promise<Runtime> => {
    const result = await this.prisma.runtime.findUnique({ where: { id } });
    if (!result) return undefined;

    return this.formatRuntime(result as StrategyTypeDTO);
  };

  getScenarioBySetId = async (id: number): Promise<Scenario> => {
    const { scenario } = await this.prisma.scenarioSet.findUnique({ where: { id }, include: { scenario: true } });
    const strategy: StrategyItem = {
      id: scenario.strategyId,
      name: scenario.strategy,
      type: scenario.strategyType as StrategyItemType,
      path: scenario.strategyPath,
    };

    return {
      ...scenario,
      strategy,
    };
  };

  saveRuntime = async (raw: StrategyTypeDTO): Promise<number> => {
    let item: PrismaRuntime;
    const args: KeyValueType[] = Array.isArray(raw.args) ? [...raw.args.filter(({ key }) => key !== 'exchange')] : [];

    if (!raw.prefix) {
      raw.prefix = nanoid(6);
    }
    if (raw.exchange) {
      args.push({ key: 'exchange', value: raw.exchange });
      delete raw['exchange'];
    }

    if (!raw.id) {
      delete raw['id'];
      item = await this.prisma.runtime.create({
        data: { ...raw, args: JSON.stringify(args) },
      });
    } else {
      item = await this.prisma.runtime.update({
        where: { id: raw.id },
        data: { ...raw, args: JSON.stringify(args) },
      });
    }

    return item.id;
  };

  removeRuntime = async (id: number): Promise<void> => {
    await this.prisma.runtime.delete({ where: { id } });
  };

  getFileTree = () => {
    const generateFileTree = (sourcePath: string) => {
      return fs.readdirSync(sourcePath, { withFileTypes: true }).map((file) => {
        const filePath = path.join(sourcePath, file.name).replace(this.sourcePath, '').replace(/\\/g, '/');
        if (file.isFile()) {
          const content = fs.readFileSync(path.join(sourcePath, file.name), { encoding: 'utf-8' });

          return {
            type: 'file',
            path: filePath,
            name: file.name,
            content,
          };
        }

        return {
          type: 'dir',
          name: file.name,
          path: filePath,
          children: generateFileTree(path.join(sourcePath, file.name)),
        };
      });
    };

    return generateFileTree(this.sourcePath);
  };

  getFileTreeStrategyContent = (filePath: string[]) => {
    return {
      path: filePath.join('/'),
      filename: filePath[filePath.length - 1],
      content: fs.readFileSync(path.join(this.sourcePath, ...filePath)).toString(),
    };
  };

  saveStrategy = (filePath: string[], content: string) => {
    let sourcePath = this.sourcePath;
    filePath.forEach((pathPiece) => {
      if (!/\.\w+$/g.test(pathPiece)) {
        if (!fs.existsSync(path.join(sourcePath, pathPiece))) {
          fs.mkdirSync(path.join(sourcePath, pathPiece));
        }

        sourcePath = path.join(sourcePath, pathPiece);
      }
    });

    fs.writeFileSync(path.join(this.sourcePath, ...filePath), content);
  };

  removeStrategy = (filePath: string[]) => {
    const stats = fs.statSync(path.join(this.sourcePath, ...filePath));
    fs.rmSync(path.join(this.sourcePath, ...filePath), { recursive: stats.isDirectory() });
  };

  renameStrategy = (filePath: string[], newFilePath: string[], content?: string) => {
    if (!content) {
      fs.renameSync(path.join(this.sourcePath, ...filePath), path.join(this.sourcePath, ...newFilePath));
      return;
    }

    fs.writeFileSync(path.join(this.sourcePath, ...filePath), content);
    fs.renameSync(path.join(this.sourcePath, ...filePath), path.join(this.sourcePath, ...newFilePath));
  };

  private formatRuntime = (runtime: StrategyTypeDTO): Runtime => {
    const args: KeyValueType[] = JSON.parse(runtime.args as string);

    return {
      ...runtime,
      strategy: {
        id: runtime.strategyId,
        name: runtime.strategy,
        type: runtime.strategyType as StrategyItemType,
        path: runtime.strategyPath,
      },
      exchange: args.find(({ key }) => key === 'exchange')?.value.toString(),
      args: args.filter(({ key }) => key !== 'exchange'),
      artifacts: ScriptArtifactsService.createArtifactsKey([runtime.id, 'runtime']),
    };
  };
}
