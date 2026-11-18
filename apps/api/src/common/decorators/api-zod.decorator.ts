import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import { z, type ZodType } from 'zod';

type JsonSchema = Record<string, unknown>;

function toSchema(schema: ZodType): JsonSchema {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema;
  delete json.$schema;
  return json;
}

/** Documenta no Swagger o corpo do pedido a partir do schema Zod partilhado. */
export const ApiZodBody = (schema: ZodType) => ApiBody({ schema: toSchema(schema) as never });

/** Documenta no Swagger os parâmetros de query a partir de um z.object. */
export function ApiZodQuery(schema: ZodType) {
  const json = toSchema(schema) as { properties?: Record<string, JsonSchema>; required?: string[] };
  const props = json.properties ?? {};
  return applyDecorators(
    ...Object.entries(props).map(([name, s]) =>
      ApiQuery({ name, required: json.required?.includes(name) ?? false, schema: s as never }),
    ),
  );
}
