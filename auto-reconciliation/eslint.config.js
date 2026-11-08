import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/drizzle/**",
      "**/playwright-report/**",
      "**/test-results/**"
    ]
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-console": "error",
      "no-debugger": "error",
      "no-eval": "error",
      "no-new-func": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date']",
          message: "业务代码禁止裸 Date，统一走 engine 的 Time 封装"
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='parse']",
          message: "禁止 Date.parse，统一走 engine 的 Time 封装"
        },
        {
          selector: "CallExpression[callee.property.name='toFixed']",
          message: "禁止 toFixed 处理金额，统一走 Money 封装"
        },
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message: "禁止 parseFloat 处理金额，统一走 Money 封装"
        }
      ]
    }
  },
  {
    files: ["packages/engine/src/time.ts", "packages/engine/src/money.ts"],
    rules: {
      "no-restricted-syntax": "off"
    }
  },
  {
    // 规范 2.4.2：时区呈现允许出现在 UI 格式化边界；金额仍只用字符串展示
    files: ["apps/web/src/lib/format.ts"],
    rules: {
      "no-restricted-syntax": "off"
    }
  },
  {
    files: ["packages/adapters/**/*.ts", "apps/**/*.ts", "apps/**/*.tsx", "packages/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "decimal.js",
              message: "仅 packages/engine 可直接使用 decimal.js"
            },
            {
              name: "date-fns",
              message: "仅 packages/engine 可直接使用 date-fns"
            },
            {
              name: "date-fns-tz",
              message: "仅 packages/engine 可直接使用 date-fns-tz"
            }
          ]
        }
      ]
    }
  }
);
