import styled, { css } from "styled-components";

// Цветовая палитра - меняй тут, а не по всему коду
export const colors = {
  primary: "#4285f4",
  danger: "#ea4335",
  secondary: "#757575",
  text: "#222",
  textLight: "#333",
  border: "#ddd",
  borderLight: "#e0e0e0",
  bg: "#ffffff",
  bgHover: "#f9f9f9",
  bgDark: "#1e1e1e",
  textCode: "#d4d4d4",
};

// Сброс дефолтных стилей
const resetButton = css`
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  cursor: pointer;
`;

const resetInput = css`
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  box-sizing: border-box;
`;

export const Container = styled.div`
  max-width: min(1200px, 100vw - 40px); // адаптивно, не шире экрана
  margin: 0 auto;
  padding: 20px;
`;

export const Card = styled.div`
  background: linear-gradient(135deg, #ffffff 0%, #f8f9fc 100%);
  border-radius: 16px;
  padding: 36px;
  box-shadow:
    0 4px 20px rgba(0, 0, 0, 0.08),
    0 1px 3px rgba(0, 0, 0, 0.05);
  border: 1px solid rgba(0, 0, 0, 0.04);
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.1);
  }
`;

export const Title = styled.h1`
  font-size: 32px;
  text-align: center;
  margin: 0 0 44px 0;
  color: #1a1a1a;
  font-weight: 700;
  background: linear-gradient(90deg, #4285f4, #34a853);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  letter-spacing: -0.5px;
`;

export const Button = styled.button<{
  $variant?: "primary" | "danger" | "secondary";
  $fullWidth?: boolean;
}>`
  ${resetButton}
  padding: 14px 32px;
  font-weight: 600;
  font-size: 16px;
  border-radius: 12px;
  transition: all 0.2s ease;
  width: ${({ $fullWidth }) => ($fullWidth ? "100%" : "auto")};
  position: relative;
  overflow: hidden;

  background: ${({ $variant }) => {
    switch ($variant) {
      case "danger":
        return "linear-gradient(135deg, #ea4335, #c5221f)";
      case "secondary":
        return "linear-gradient(135deg, #9e9e9e, #757575)";
      default:
        return "linear-gradient(135deg, #4285f4, #1a73e8)";
    }
  }};

  color: white;
  box-shadow: 0 4px 12px rgba(66, 133, 244, 0.3);

  &:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(66, 133, 244, 0.4);
  }

  &:active:not(:disabled) {
    transform: translateY(0);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }

  &::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(255, 255, 255, 0.15);
    opacity: 0;
    transition: opacity 0.2s;
  }

  &:hover::before {
    opacity: 1;
  }
`;
export const Input = styled.input<{ $hasError?: boolean }>`
  ${resetInput}

  width: 100%;
  padding: 12px 14px;
  border: 1px solid
    ${({ $hasError }) => ($hasError ? colors.danger : colors.border)};
  border-radius: 8px;
  font-size: 15px;
  background: ${colors.bg};
  transition:
    border-color 0.15s,
    outline 0.15s;

  &:focus {
    outline: 2px solid
      ${({ $hasError }) => ($hasError ? colors.danger : colors.primary)};
    outline-offset: -1px;
    border-color: transparent;
  }

  &::placeholder {
    color: ${colors.secondary};
    opacity: 0.6;
  }
`;

export const Label = styled.label`
  display: block;
  margin-bottom: 6px;
  font-weight: 500;
  font-size: 14px;
  color: ${colors.textLight};
`;

export const FormField = styled.div`
  margin-bottom: 16px;

  &:last-child {
    margin-bottom: 0;
  }
`;

export const LogBox = styled.pre<{ $maxHeight?: string }>`
  background: ${colors.bgDark};
  color: ${colors.textCode};
  padding: 16px;
  border-radius: 8px;
  max-height: ${({ $maxHeight }) => $maxHeight || "400px"};
  overflow-y: auto;
  font-family: "SF Mono", Monaco, "Cascadia Code", "Courier New", monospace;
  font-size: 13px;
  line-height: 1.5;
  margin: 0;

  /* кастомный скроллбар для десктопа */
  &::-webkit-scrollbar {
    width: 8px;
  }
  &::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 4px;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 4px;

    &:hover {
      background: rgba(255, 255, 255, 0.3);
    }
  }
`;

export const Table = styled.div`
  border: 1px solid ${colors.borderLight};
  border-radius: 8px;
  overflow: hidden;
`;

export const TableHeader = styled.div`
  display: flex;
  padding: 12px 16px;
  background: ${colors.bgHover};
  font-weight: 600;
  font-size: 14px;
  color: ${colors.textLight};
  border-bottom: 1px solid ${colors.borderLight};
  gap: 16px;
`;

export const TableRow = styled.div<{ $disabled?: boolean }>`
  display: flex;
  padding: 14px 16px;
  border-bottom: 1px solid ${colors.borderLight};
  align-items: center;
  gap: 16px;
  opacity: ${({ $disabled }) => ($disabled ? 0.5 : 1)};

  &:hover {
    background: ${colors.bgHover};
  }

  &:last-child {
    border-bottom: none;
  }
`;

export const TableCell = styled.div<{ $flex?: number; $minWidth?: string }>`
  flex: ${({ $flex }) => $flex || 1};
  min-width: ${({ $minWidth }) => $minWidth || "0"};
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const Checkbox = styled.input.attrs({ type: "checkbox" })<{
  $error?: boolean;
}>`
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: ${({ $error }) => ($error ? colors.danger : colors.primary)};
  flex-shrink: 0;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
`;

// Бонус: группа кнопок
export const ButtonGroup = styled.div<{ $justify?: string }>`
  display: flex;
  gap: 12px;
  justify-content: ${({ $justify }) => $justify || "flex-start"};
  flex-wrap: wrap;
`;

// Бонус: текст ошибки
export const ErrorText = styled.span`
  display: block;
  color: ${colors.danger};
  font-size: 13px;
  margin-top: 4px;
`;

export const InfoBlock = styled.div`
  background: #f0f4ff;
  border: 1px solid #90caf9;
  border-radius: 12px;
  padding: 14px 16px;
  margin-bottom: 24px;
  font-size: 14px;
  color: #1a1a1a;
`;

export const InfoTitle = styled.div`
  font-weight: 600;
  margin-bottom: 4px;
`;

export const InfoText = styled.div`
  opacity: 0.8;
  font-size: 13px;
`;

export const CacheBadge = styled.span`
  background: #e8f5e8;
  color: #2e7d32;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  margin-left: 8px;
`;
