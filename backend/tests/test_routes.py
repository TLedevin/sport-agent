from app.routes import encode, points_from_details, simplify


def test_encode_matches_googles_reference():
    # The example from Google's "Encoded Polyline Algorithm Format" page.
    assert encode([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]) == "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
    assert encode([]) == ""


def test_simplify_keeps_the_shape_and_drops_straight_lines():
    straight = [[48.0, 2.0 + i * 0.001] for i in range(100)]
    assert simplify(straight) == [straight[0], straight[-1]]
    corner = straight + [[48.0 + i * 0.001, 2.099] for i in range(1, 50)]
    assert simplify(corner) == [straight[0], straight[-1], corner[-1]]
    loop = [[48.0, 2.0], [48.01, 2.0], [48.01, 2.01], [48.0, 2.0]]  # ends where it started
    assert simplify(loop) == loop
    assert simplify([[48.0, 2.0]]) == [[48.0, 2.0]]


def test_points_from_details_skip_samples_without_a_fix():
    data = {"series": {"metrics": {"directLatitude": [48.0, None, 48.1], "directLongitude": [2.0, 2.05, 2.1]}}}
    assert points_from_details(data) == [[48.0, 2.0], [48.1, 2.1]]
    assert points_from_details({"series": None}) == []
