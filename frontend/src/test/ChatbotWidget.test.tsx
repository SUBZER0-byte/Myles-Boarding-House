import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { askChatbot } from "@/lib/chatbot";
import { ChatbotWidget } from "@/components/ChatbotWidget";

vi.mock("@/hooks/useChatPolling", () => ({
  useChatPolling: () => ({
    data: ["How do I book a room?"],
    error: null,
    loading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/lib/chatbot", () => ({
  askChatbot: vi.fn().mockResolvedValue({ type: "success", reply: "Check available rooms." }),
  getChatbotStatus: vi.fn(() => new Promise(() => {})),
  getChatbotSuggestions: vi.fn().mockResolvedValue(["How do I book a room?"]),
}));

describe("ChatbotWidget suggested questions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => cleanup());

  it("opens with suggested questions hidden", () => {
    render(<ChatbotWidget />);

    fireEvent.click(screen.getByRole("button", { name: "Open chatbot" }));

    expect(screen.getByRole("button", { name: /Suggested questions/ })).toHaveTextContent("+");
    expect(screen.queryByRole("button", { name: "How do I book a room?" })).not.toBeInTheDocument();
  });

  it("hides suggested questions after one is selected", async () => {
    render(<ChatbotWidget />);
    fireEvent.click(screen.getByRole("button", { name: "Open chatbot" }));
    fireEvent.click(screen.getByRole("button", { name: /Suggested questions/ }));
    fireEvent.click(screen.getByRole("button", { name: "How do I book a room?" }));

    expect(screen.queryByRole("button", { name: "How do I book a room?" })).not.toBeInTheDocument();
    await waitFor(() => expect(askChatbot).toHaveBeenCalledWith(
      expect.objectContaining({ message: "How do I book a room?" }),
      expect.any(AbortSignal),
    ));
    await screen.findByText("Check available rooms.");
  });
});
