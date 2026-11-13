import { supabase } from "@/lib/supabase";

export type ChatbotFaqCategory =
  | "rates"
  | "availability"
  | "house_rules"
  | "payment_methods"
  | "reservation_steps"
  | "location"
  | "other";

export type ChatbotFaq = {
  faq_id: number;
  category: ChatbotFaqCategory;
  question: string;
  answer: string;
  is_active: number;
};

export type ChatbotSuggestedQuestion = {
  suggested_question_id: number;
  question: string;
  is_active: number;
};

export type ChatbotFaqInput = {
  faq_id: number | null;
  category: ChatbotFaqCategory;
  question: string;
  answer: string;
  is_active: boolean;
};

const faqCategories = new Set<ChatbotFaqCategory>([
  "rates",
  "availability",
  "house_rules",
  "payment_methods",
  "reservation_steps",
  "location",
  "other",
]);

function parseFaqs(value: unknown): ChatbotFaq[] {
  if (!Array.isArray(value)) throw new Error("Chatbot FAQs returned an invalid response.");
  return value.map((row): ChatbotFaq => {
    if (
      !row || typeof row !== "object"
      || typeof row.faq_id !== "number"
      || !faqCategories.has(row.category)
      || typeof row.question !== "string"
      || typeof row.answer !== "string"
      || (row.is_active !== 0 && row.is_active !== 1)
    ) {
      throw new Error("Chatbot FAQs returned an invalid entry.");
    }
    return row;
  });
}

function parseSuggestedQuestions(value: unknown): ChatbotSuggestedQuestion[] {
  if (!Array.isArray(value)) throw new Error("Suggested questions returned an invalid response.");
  return value.map((row): ChatbotSuggestedQuestion => {
    if (
      !row || typeof row !== "object"
      || typeof row.suggested_question_id !== "number"
      || typeof row.question !== "string"
      || (row.is_active !== 0 && row.is_active !== 1)
    ) {
      throw new Error("Suggested questions returned an invalid entry.");
    }
    return row;
  });
}

export async function getMyAdminChatbotFaqs(): Promise<ChatbotFaq[]> {
  const { data, error } = await supabase.rpc("get_my_admin_chatbot_faqs");
  if (error) throw new Error(error.message || "Could not load chatbot FAQs.");
  return parseFaqs(data);
}

export async function saveMyAdminChatbotFaq(faq: ChatbotFaqInput): Promise<void> {
  if (
    !faqCategories.has(faq.category)
    || typeof faq.question !== "string"
    || typeof faq.answer !== "string"
    || typeof faq.is_active !== "boolean"
    || (faq.faq_id !== null && (!Number.isSafeInteger(faq.faq_id) || faq.faq_id < 1))
  ) {
    throw new Error("The chatbot FAQ update is invalid.");
  }
  const { error } = await supabase.rpc("save_my_admin_chatbot_faq", {
    p_faq_id: faq.faq_id,
    p_category: faq.category,
    p_question: faq.question,
    p_answer: faq.answer,
    p_is_active: faq.is_active,
  });
  if (error) throw new Error(error.message || "Could not save chatbot FAQ.");
}

export async function deleteMyAdminChatbotFaq(faqId: number): Promise<void> {
  if (!Number.isSafeInteger(faqId) || faqId < 1) {
    throw new Error("The chatbot FAQ identifier is invalid.");
  }
  const { error } = await supabase.rpc("delete_my_admin_chatbot_faq", { p_faq_id: faqId });
  if (error) throw new Error(error.message || "Could not delete chatbot FAQ.");
}

export async function getMyAdminChatbotSuggestedQuestions(): Promise<ChatbotSuggestedQuestion[]> {
  const { data, error } = await supabase.rpc("get_my_admin_chatbot_suggested_questions");
  if (error) throw new Error(error.message || "Could not load suggested questions.");
  return parseSuggestedQuestions(data);
}

export async function saveMyAdminChatbotSuggestedQuestion(
  question: string,
  suggestedQuestionId: number | null,
): Promise<void> {
  if (
    typeof question !== "string"
    || (suggestedQuestionId !== null
      && (!Number.isSafeInteger(suggestedQuestionId) || suggestedQuestionId < 1))
  ) {
    throw new Error("The suggested question update is invalid.");
  }
  const { error } = await supabase.rpc("save_my_admin_chatbot_suggested_question", {
    p_suggested_question_id: suggestedQuestionId,
    p_question: question,
  });
  if (error) throw new Error(error.message || "Could not save suggested question.");
}

export async function deleteMyAdminChatbotSuggestedQuestion(id: number): Promise<void> {
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error("The suggested question identifier is invalid.");
  }
  const { error } = await supabase.rpc("delete_my_admin_chatbot_suggested_question", {
    p_suggested_question_id: id,
  });
  if (error) throw new Error(error.message || "Could not delete suggested question.");
}
