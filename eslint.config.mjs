import nextVitals from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier/flat";

export default [
  { ignores: ["node_modules/**", ".next/**", "out/**", "public/**", "components/ui/**", "next-env.d.ts"] },
  ...nextVitals,
  prettier,
  {
    rules: {
      "react/no-unescaped-entities": "off",
      "@next/next/no-img-element": "off",
      "import/no-duplicates": "off",
      "import/no-unresolved": "off",
      "react-hooks/exhaustive-deps": "off",
      "import/no-named-as-default-member": "off",
    },
  },
];
