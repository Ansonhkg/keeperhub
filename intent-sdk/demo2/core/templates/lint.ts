import { lintSkillTemplates } from "./loader.js";

const result = lintSkillTemplates();

if (result.errors.length > 0) {
  console.error("v3 skill template lint failed:\n");
  for (const error of result.errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `v3 skill template lint passed: ${result.templates.length} templates checked`
  );
}
