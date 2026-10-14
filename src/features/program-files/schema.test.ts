import Ajv from "ajv";
import { expect, it } from "vitest";
import { PROGRAM_FILE_SCHEMA } from "./schema";
import { PROGRAM_FILE_EXAMPLE } from "./example";
import { exportProgramFile, parseProgramFile } from "./file";
import { makePreset, PRESETS } from "../program-editor/operations";
it("publishes a complete strict schema accepting examples and every current rich preset",()=>{
  const validate=new Ajv({allErrors:true}).compile(PROGRAM_FILE_SCHEMA);
  expect(validate(PROGRAM_FILE_EXAMPLE),JSON.stringify(validate.errors)).toBe(true);
  expect(parseProgramFile(PROGRAM_FILE_EXAMPLE).document.startDate).toBe("");
  for(const preset of PRESETS){const file=exportProgramFile(makePreset(preset.id,"2026-10-13"));expect(validate(file),`${preset.id}: ${JSON.stringify(validate.errors)}`).toBe(true);}
  const invalid=structuredClone(PROGRAM_FILE_EXAMPLE);Object.assign(invalid.program.weeks[0].days[0].exercises[0].sets[0],{magic:"value"});
  expect(validate(invalid)).toBe(false);
});
it("serves the public schema and downloadable example without a user session", async()=>{
  const schema=await import("@/app/api/program-imports/schema/route");
  const example=await import("@/app/api/program-imports/example/route");
  const schemaResponse=schema.GET(),exampleResponse=example.GET();
  expect(schemaResponse.status).toBe(200);expect(exampleResponse.headers.get("content-disposition")).toContain("example.magni.json");
  const validate=new Ajv().compile(await schemaResponse.json());
  expect(validate(await exampleResponse.json())).toBe(true);
});
