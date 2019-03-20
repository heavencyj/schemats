/**
 * Generate typescript interface from table schema
 * Created by xiamx on 2016-08-10.
 */
// I'm awful, but these rules are rough to write against for now
//tslint:disable

import { getDatabase, Database } from './schema';
import Options, { OptionValues } from './options';
import { processString, Options as ITFOptions } from 'typescript-formatter';
import * as _ from 'lodash';

import { TableDefinition, ColumnDefinition } from './schemaInterfaces';

function nameIsReservedKeyword(name: string): boolean {
    const reservedKeywords = ['string', 'number', 'package'];
    return reservedKeywords.indexOf(name) !== -1;
}

function normalizeName(name: string, options: Options): string {
    if (nameIsReservedKeyword(name)) {
        return name + '_';
    } else {
        return name;
    }
}

export function generateEnumType(enumObject: any, options: Options) {
    let enumString = '';
    for (let enumNameRaw in enumObject) {
        const enumName = options.transformTypeName(enumNameRaw);
        const keys = enumObject[enumNameRaw].map((v: string) => `'${v}': null`);
        enumString += `
        export const ${enumName} = t.keyof({
          ${keys.join(',\n')}
        });\n
      `;
    }
    return enumString;
}

function getIoTSType(definition: ColumnDefinition): string {
    let baseType: string;
    switch (definition.tsType) {
        case 'any':
            baseType = 't.unknown';
            break;
        case 'string':
        case 'number':
        case 'boolean':
            baseType = `t.${definition.tsType}`;
            break;
        case 'Object':
        case 'Date':
            baseType = 't.union([t.array(t.string), t.array(extra.date)])';
            break;

        case 'Array<number>':
            baseType = 't.array(t.number)';
            break;
        case 'Array<boolean>':
            baseType = 't.array(t.boolean)';
            break;
        case 'Array<string>':
            baseType = 't.array(t.string)';
            break;
        case 'Array<Object>':
            baseType = 't.array(t.UnknownRecord)';
            break;
        case 'Array<Date>':
            baseType = 't.union([t.array(t.string), t.array(extra.DateFromISOString)])';
            break;
        case 'Buffer':
            baseType = 't.unknown';
            break;
        case undefined:
            throw new Error('We received undefined when trying to create io-ts types!');
        default:
            // This is the enum types
            // note this
            baseType = definition.tsType;
            break;
    }

    return definition.nullable ? `t.array([${baseType}, t.null])` : baseType;
}

function generateTable(tableNameRaw: string, tableDefinition: TableDefinition, options: Options): string {
    const table = options.transformTypeName(tableNameRaw);
    const keys = Object.keys(tableDefinition).map(colRaw => {
        const definition = tableDefinition[colRaw];
        const column = normalizeName(options.transformColumnName(colRaw), options);
        const ioTsType = getIoTSType(definition);
        return `${column}: ${ioTsType}`;
    });

    return `
  export const runtime_${table} = t.type({ ${keys.join(',\n')} });
  export type ${table} = t.TypeOf<typeof runtime_${table}>
  `;
}

async function ioTsOfTable(db: Database | string, table: string, schema: string, options = new Options()) {
    if (typeof db === 'string') {
        db = getDatabase(db);
    }

    let interfaces = '';
    let tableTypes = await db.getTableTypes(table, schema, options);
    interfaces += generateTable(table, tableTypes, options);
    return interfaces;
}

export async function generate(
    db: Database | string,
    tables: string[] = [],
    schema: string | null = null,
    options: OptionValues = {},
): Promise<string> {
    if (typeof db === 'string') {
        db = getDatabase(db);
    }

    if (!schema) {
        schema = db.getDefaultSchema();
    }

    if (tables.length === 0) {
        tables = await db.getSchemaTables(schema);
    }

    const optionsObject = new Options(options);

    const enumTypes = generateEnumType(await db.getEnumTypes(schema), optionsObject);
    const interfacePromises = tables.map(table => ioTsOfTable(db, table, schema as string, optionsObject));
    const ioTS = await Promise.all(interfacePromises).then(tsOfTable => tsOfTable.join(''));

    let output = `
import * as t from 'io-ts';
import * as extra from 'io-ts-types';

`;
    output += enumTypes;
    output += ioTS;

    const formatterOption: ITFOptions = {
        replace: false,
        verify: false,
        tsconfig: true,
        tslint: true,
        editorconfig: true,
        tsfmt: true,
        vscode: false,
        tsconfigFile: null,
        tslintFile: null,
        vscodeFile: null,
        tsfmtFile: null,
    };

    const processedResult = await processString('schema.ts', output, formatterOption);
    return processedResult.dest;
}
