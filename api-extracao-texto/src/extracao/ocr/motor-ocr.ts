export interface MotorOcr {
  lerImagem(caminho: string): Promise<string>;
}

export const MOTOR_OCR = Symbol('MOTOR_OCR');
