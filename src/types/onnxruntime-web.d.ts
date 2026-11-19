declare module 'onnxruntime-web' {
  export interface Tensor {
    readonly data: Float32Array | Uint8Array | Int32Array;
    readonly dims: readonly number[];
    dispose?(): void;
  }

  export const Tensor: {
    new (type: 'float32', data: Float32Array, dims: readonly number[]): Tensor;
  };

  export interface InferenceSession {
    readonly inputNames: readonly string[];
    readonly outputNames: readonly string[];
    run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
  }

  export const InferenceSession: {
    create(
      model: Uint8Array | ArrayBuffer,
      options?: { executionProviders?: string[] }
    ): Promise<InferenceSession>;
  };

  export const env: {
    wasm: {
      wasmPaths?: string | Record<string, string>;
    };
  };
}
