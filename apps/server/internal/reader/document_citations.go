package reader

import (
	"regexp"
	"strings"
)

var documentCitationPattern = regexp.MustCompile(`\[S[1-9][0-9]*\]|[^]*(?:|)`)
var documentSourceIDPattern = regexp.MustCompile(`^S[1-9][0-9]*$`)

// Provider markers and Reader labels resolve through the same evidence check.
// Unknown IDs, malformed markers and unfinished citations never bypass it.
func documentCitationSources(text string) ([]string, error) {
	sources := []string{}
	for _, marker := range documentCitationPattern.FindAllString(text, -1) {
		if strings.HasPrefix(marker, "[") {
			sources = append(sources, marker[1:len(marker)-1])
			continue
		}
		parts := strings.Split(strings.TrimSuffix(strings.TrimPrefix(marker, ""), ""), "")
		kind := parts[0]
		if !strings.HasPrefix(kind, "cite") && !strings.HasPrefix(kind, "filecite") && !strings.HasPrefix("cite", kind) && !strings.HasPrefix("filecite", kind) {
			continue // Other provider marker families are not document citations.
		}
		if !strings.HasSuffix(marker, "") || (kind != "cite" && kind != "filecite") || len(parts) < 2 {
			return nil, generationError(ErrorProtocol, "回答的来源标记不完整，请重试")
		}
		for _, source := range parts[1:] {
			if !documentSourceIDPattern.MatchString(source) {
				return nil, generationError(ErrorProtocol, "回答包含无法识别的来源，请重试")
			}
			sources = append(sources, source)
		}
	}
	return sources, nil
}
