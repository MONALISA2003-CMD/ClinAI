declare module '*.json' { const value:any; export default value; }
declare module 'react' {
  export function useState<T>(initial:T): [T,(value:T|((prev:T)=>T))=>void];
  export function useEffect(effect:()=>void|(()=>void),deps?:any[]):void;
  export function useMemo<T>(factory:()=>T,deps:any[]):T;
  export function useRef<T>(value:T):{current:T};
  export function useCallback<T extends (...args:any[])=>any>(callback:T,deps:any[]):T;
}
declare module 'react/jsx-runtime' { export const jsx:any; export const jsxs:any; export const Fragment:any; }
declare namespace JSX { interface IntrinsicElements { [elemName:string]: any; } }
declare const process: any;
