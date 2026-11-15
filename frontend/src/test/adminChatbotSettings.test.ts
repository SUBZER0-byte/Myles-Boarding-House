import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc },
}));

import {
  deleteMyAdminChatbotFaq,
  deleteMyAdminChatbotSuggestedQuestion,
  getMyAdminChatbotFaqs,
  getMyAdminChatbotSuggestedQuestions,
  saveMyAdminChatbotFaq,
  saveMyAdminChatbotSuggestedQuestion,
} from "@/lib/adminChatbotSettings";

describe("Admin chatbot settings", () => {
  beforeEach(() => rpc.mockReset());

  it("loads FAQ and suggested-question lists through Admin RPCs", async () => {
    const faqs = [{
      faq_id: 8,
      category: "rates",
      question: "What is the rate?",
      answer: "See room details.",
      is_active: 1,
    }];
    const suggestions = [{ suggested_question_id: 3, question: "What should I bring?", is_active: 1 }];
    rpc.mockResolvedValueOnce({ data: faqs, error: null });
    rpc.mockResolvedValueOnce({ data: suggestions, error: null });

    await expect(getMyAdminChatbotFaqs()).resolves.toEqual(faqs);
    await expect(getMyAdminChatbotSuggestedQuestions()).resolves.toEqual(suggestions);
    expect(rpc).toHaveBeenNthCalledWith(1, "get_my_admin_chatbot_faqs");
    expect(rpc).toHaveBeenNthCalledWith(2, "get_my_admin_chatbot_suggested_questions");
  });

  it("saves and deletes FAQs through the Admin RPCs", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await saveMyAdminChatbotFaq({
      faq_id: 8,
      category: "rates",
      question: " Updated rate question ",
      answer: "Updated answer",
      is_active: false,
    });
    await deleteMyAdminChatbotFaq(8);

    expect(rpc).toHaveBeenNthCalledWith(1, "save_my_admin_chatbot_faq", {
      p_faq_id: 8,
      p_category: "rates",
      p_question: " Updated rate question ",
      p_answer: "Updated answer",
      p_is_active: false,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "delete_my_admin_chatbot_faq", { p_faq_id: 8 });
  });

  it("saves and deletes suggested questions through the Admin RPCs", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await saveMyAdminChatbotSuggestedQuestion("What should I bring?", null);
    await deleteMyAdminChatbotSuggestedQuestion(3);

    expect(rpc).toHaveBeenNthCalledWith(1, "save_my_admin_chatbot_suggested_question", {
      p_suggested_question_id: null,
      p_question: "What should I bring?",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "delete_my_admin_chatbot_suggested_question", {
      p_suggested_question_id: 3,
    });
  });

  it("rejects malformed rows and invalid IDs instead of silently accepting them", async () => {
    rpc.mockResolvedValue({ data: [{ faq_id: "bad" }], error: null });
    await expect(getMyAdminChatbotFaqs()).rejects.toThrow("invalid entry");
    rpc.mockClear();

    await expect(deleteMyAdminChatbotFaq(0)).rejects.toThrow("identifier is invalid");
    await expect(deleteMyAdminChatbotSuggestedQuestion(0)).rejects.toThrow("identifier is invalid");
    expect(rpc).not.toHaveBeenCalled();
  });
});
