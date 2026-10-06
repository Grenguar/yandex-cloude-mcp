/** Compile request JSON schemas from the pinned SDK declarations, not hand-copied API shapes. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { serviceSpecs, excludedMethod, isReadMethod } from '../src/service-specs.js';
const require = createRequire(import.meta.url);
const sdkRoot = path.dirname(require.resolve('@yandex-cloud/nodejs-sdk'));
const sources = serviceSpecs.map(([id, group, namespace]) => {
  const index = require.resolve(`@yandex-cloud/nodejs-sdk/${group}`).replace(/\.js$/, '.d.ts');
  const match = fs
    .readFileSync(index, 'utf8')
    .match(new RegExp(`export \\* as ${namespace} from '([^']+)'`));
  if (!match) throw new Error(`SDK namespace missing: ${id}`);
  const file = path.resolve(path.dirname(index), match[1]! + '.d.ts');
  return { id, file };
});
const program = ts.createProgram(
  sources.map((s) => s.file),
  {
    strict: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2023,
    moduleResolution: ts.ModuleResolutionKind.Node10,
  },
);
const checker = program.getTypeChecker();
type Schema = Record<string, any>;
const definitions: Record<string, Schema> = {};
const seen = new Map<ts.Type, string>();
const schemaFor = (type: ts.Type): Schema => {
  if (type.isUnion()) {
    const parts = type.types.filter((t) => !(t.flags & ts.TypeFlags.Undefined));
    if (parts.length === 1) return schemaFor(parts[0]!);
    return { anyOf: parts.map(schemaFor) };
  }
  if (type.flags & ts.TypeFlags.EnumLiteral) {
    const literal = type as ts.LiteralType;
    const name = type.getSymbol()?.getName();
    return { enum: name ? [name, literal.value] : [literal.value] };
  }
  if (type.isStringLiteral() || type.isNumberLiteral()) return { const: type.value };
  if (type.flags & ts.TypeFlags.String) return { type: 'string' };
  if (type.flags & ts.TypeFlags.Number)
    return { type: 'number', minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER };
  if (type.flags & ts.TypeFlags.BooleanLike) return { type: 'boolean' };
  if (type.flags & ts.TypeFlags.Null) return { type: 'null' };
  const name = type.getSymbol()?.getName();
  if (name === 'Date') return { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T.+Z$' };
  if (name === 'Uint8Array' || name === 'Buffer')
    return { type: 'string', contentEncoding: 'base64' };
  if (checker.isArrayType(type))
    return {
      type: 'array',
      maxItems: 1000,
      items: schemaFor(checker.getTypeArguments(type as ts.TypeReference)[0]!),
    };
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return {};
  const existing = seen.get(type);
  if (existing) return { $ref: `#/$defs/${existing}` };
  const key = `${name ?? 'Object'}_${seen.size}`;
  seen.set(type, key);
  const schema: Schema = { type: 'object', properties: {}, additionalProperties: false };
  definitions[key] = schema;
  const indexType = checker.getIndexTypeOfType(type, ts.IndexKind.String);
  if (indexType) schema.additionalProperties = schemaFor(indexType);
  for (const property of type.getProperties()) {
    const decl = property.valueDeclaration ?? property.declarations?.[0];
    if (!decl) throw new Error('No declaration for ' + property.name);
    const item = schemaFor(checker.getTypeOfSymbolAtLocation(property, decl));
    const description = ts.displayPartsToString(property.getDocumentationComment(checker));
    schema.properties[property.name] = description ? { ...item, description } : item;
    if (property.name === 'pageSize')
      schema.properties[property.name] = {
        type: 'integer',
        minimum: 1,
        maximum: 1000,
        description,
      };
  }
  // Protobuf scalars have defaults even when TS marks them required. The cloud API
  // validates required/conditional business fields; never silently strip unknowns.
  return { $ref: `#/$defs/${key}` };
};
const services: Record<string, any> = {};
for (const { id, file } of sources) {
  const mod = require(file.replace(/\.d\.ts$/, '.js'));
  const source = program.getSourceFile(file)!;
  const symbol = checker.getSymbolAtLocation(source)!;
  const exports = checker.getExportsOfModule(symbol);
  const clientName = Object.keys(mod).find((k) => k.endsWith('ServiceClient'))!;
  const serviceName = clientName.replace(/Client$/, 'Service');
  const serviceSymbol = exports.find((s) => s.name === serviceName);
  if (!serviceSymbol) throw new Error('No service declaration ' + id);
  const serviceType = checker.getTypeOfSymbolAtLocation(serviceSymbol, source);
  const methods: Record<string, any> = {};
  for (const [method, descriptor] of Object.entries(mod[clientName].service) as [string, any][]) {
    if (descriptor.requestStream || descriptor.responseStream || excludedMethod(id, method))
      continue;
    const methodSymbol = serviceType.getProperty(method)!;
    const methodType = checker.getTypeOfSymbolAtLocation(methodSymbol, source);
    const serializer = methodType.getProperty('requestSerialize')!;
    const signature = checker.getTypeOfSymbolAtLocation(serializer, source).getCallSignatures()[0]!;
    const requestType = checker.getTypeOfSymbolAtLocation(signature.parameters[0]!, source);
    const requestSymbol = requestType.getSymbol()!;
    const requestFile = requestSymbol.declarations![0]!.getSourceFile().fileName;
    methods[method] = {
      readOnly: isReadMethod(id, method),
      schema: schemaFor(requestType),
      requestType: requestSymbol.name,
      requestModule: path.relative(sdkRoot, requestFile).replace(/\.d\.ts$/, '.js'),
      description: ts.displayPartsToString(methodSymbol.getDocumentationComment(checker)),
    };
  }
  services[id] = {
    module: path.relative(sdkRoot, file).replace(/\.d\.ts$/, '.js'),
    clientName,
    methods,
  };
}
fs.mkdirSync('src/generated', { recursive: true });
fs.writeFileSync(
  'src/generated/catalog.json',
  JSON.stringify({ sdkVersion: '3.2.0', services, definitions }, null, 2) + '\n',
);
console.log(
  `Generated ${Object.keys(services).length} services / ${Object.values(services).reduce((n, s) => n + Object.keys(s.methods).length, 0)} methods`,
);
