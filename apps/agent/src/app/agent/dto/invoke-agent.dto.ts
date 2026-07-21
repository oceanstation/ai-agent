/**
 * 调用 DeepAgent 的请求体
 */
export class InvokeAgentDto {
  /** 用户输入的问题 / 指令 */
  message!: string;
}
