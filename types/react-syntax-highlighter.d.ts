declare module "react-syntax-highlighter" {
  import { ComponentType } from "react";

  export interface SyntaxHighlighterProps {
    children: string;
    style?: any;
    language?: string;
    PreTag?: string | ComponentType<any>;
    customStyle?: React.CSSProperties;
    codeTagProps?: any;
    [key: string]: any;
  }

  export const Prism: ComponentType<SyntaxHighlighterProps>;
  export default function SyntaxHighlighter(
    props: SyntaxHighlighterProps
  ): JSX.Element;
}

declare module "react-syntax-highlighter/dist/esm/styles/prism" {
  export const oneDark: any;
  export const oneLight: any;
  export const tomorrow: any;
  export const twilight: any;
  export const vs: any;
  export const vscDarkPlus: any;
  export const xonokai: any;
}
