// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddExerciseForm } from "@/components/AddExerciseForm";
import { listTrainingTemplates } from "@/features/training-templates/registry";

const routerMock = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

afterEach(() => {
  routerMock.refresh.mockClear();
});

describe("AddExerciseForm", () => {
  it("renders progression options from the training template registry", () => {
    render(<AddExerciseForm dayId={1} />);

    const select = screen.getByLabelText("Progression");
    const optionLabels = within(select)
      .getAllByRole("option")
      .map((option) => option.textContent);
    const optionValues = within(select)
      .getAllByRole("option")
      .map((option) => option.getAttribute("value"));

    expect(optionLabels).toEqual(listTrainingTemplates().map((template) => template.name));
    expect(optionValues).toEqual(listTrainingTemplates().map((template) => template.id));
  });
});
